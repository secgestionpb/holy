#!/usr/bin/env python3
"""Backup de Supabase Storage (5 buckets) + verificación + purga semi-manual.

Uso:
  python scripts/backup_storage.py                     # dry-run: backup + verify + reporte
  python scripts/backup_storage.py --apply --report <archivo.json>   # purga lo listado en el reporte

Requiere en .env.local (raíz del repo):
  SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY
  BACKUP_DIR       carpeta destino del espejo (local o red del hotel)
  RETENTION_DAYS   opcional, default 120 (retención solo bucket ot_evidencias)

Orden SIEMPRE: backup -> verificar -> limpiar (sin verificación exitosa del
bucket no se purga nada de ese bucket). Sin dependencias externas (stdlib).

Task Scheduler (ejemplo, a cargo del operador):
  schtasks /Create /TN "CMMS-Backup-Storage" /SC DAILY /ST 02:00 ^
    /TR "python C:\\ruta\\al\\repo\\scripts\\backup_storage.py"
"""
import argparse
import json
import os
import sys
import time
import urllib.request
import urllib.error
from datetime import datetime, timezone

try:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")
except Exception:
    pass

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ENV_PATH = os.path.join(ROOT, ".env.local")

BUCKETS = ["usuarios", "activos", "ot_evidencias", "documentos", "reportes"]
RETENTION_BUCKET = "ot_evidencias"
DELETE_BATCH = 100
RETRIES = 3
BACKOFFS = [2, 8, 20]

env = {}
if os.path.exists(ENV_PATH):
    for line in open(ENV_PATH, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k.strip()] = v.strip().strip('"').strip("'")

URL = os.environ.get("SUPABASE_URL") or env.get("SUPABASE_URL", "")
SERVICE = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or env.get("SUPABASE_SERVICE_ROLE_KEY", "")
BACKUP_DIR = os.environ.get("BACKUP_DIR") or env.get("BACKUP_DIR", "")
RETENTION_DAYS = int(os.environ.get("RETENTION_DAYS") or env.get("RETENTION_DAYS") or "120")

LOG_LINES = []


def log(msg):
    stamp = datetime.now().strftime("%H:%M:%S")
    line = f"[{stamp}] {msg}"
    print(line, flush=True)
    LOG_LINES.append(line)


def req(path, method="GET", data=None, raw_body=None, ctype="application/json", timeout=120):
    h = {"apikey": SERVICE, "Authorization": f"Bearer {SERVICE}"}
    if raw_body is not None or data is not None:
        h["Content-Type"] = ctype
    if raw_body is not None:
        body = raw_body if isinstance(raw_body, bytes) else raw_body.encode()
    else:
        body = json.dumps(data).encode() if data is not None else None
    r = urllib.request.Request(URL + path, data=body, headers=h, method=method)
    try:
        with urllib.request.urlopen(r, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def req_json(path, method="GET", data=None):
    status, body = req(path, method=method, data=data)
    if status >= 400:
        raise RuntimeError(f"{method} {path} -> {status}: {body[:300]!r}")
    return json.loads(body) if body else None


def list_bucket(bucket):
    """Lista recursiva -> solo archivos (name sin metadata de carpeta)."""
    files = []

    def walk(prefix):
        offset = 0
        while True:
            payload = {"prefix": prefix, "limit": 100, "offset": offset,
                       "sortBy": {"column": "name", "order": "asc"}}
            entries = req_json(f"/storage/v1/object/list/{bucket}", method="POST", data=payload)
            if not entries:
                return
            for e in entries:
                name = e.get("name", "")
                full = f"{prefix}{name}"
                meta = e.get("metadata") or {}
                if meta.get("size") is not None and e.get("id"):
                    files.append({
                        "path": full,
                        "size": int(meta.get("size") or 0),
                        "etag": meta.get("eTag") or "",
                        "created_at": e.get("created_at") or "",
                        "updated_at": e.get("updated_at") or "",
                    })
                elif not e.get("id"):
                    walk(full + "/")
            if len(entries) < 100:
                return
            offset += 100

    walk("")
    return files


def download_object(bucket, path, dest):
    for attempt, backoff in enumerate([0] + BACKOFFS):
        if backoff:
            time.sleep(backoff)
        status, body = req(f"/storage/v1/object/{bucket}/{path}", method="GET", timeout=180)
        if status == 200:
            os.makedirs(os.path.dirname(dest), exist_ok=True)
            tmp = dest + ".part"
            with open(tmp, "wb") as f:
                f.write(body)
            os.replace(tmp, dest)
            return True, len(body)
        log(f"    descarga fallida ({status}) intento {attempt + 1}: {bucket}/{path}")
    return False, 0


def load_manifest(bucket, mdir):
    p = os.path.join(mdir, f"{bucket}.json")
    if os.path.exists(p):
        try:
            return json.load(open(p, encoding="utf-8"))
        except Exception:
            return {}
    return {}


def save_manifest(bucket, mdir, manifest):
    p = os.path.join(mdir, f"{bucket}.json")
    with open(p, "w", encoding="utf-8") as f:
        json.dump(manifest, f, indent=0, sort_keys=True)


def backup_bucket(bucket, bdir, mdir):
    log(f"Bucket {bucket}: listando…")
    remote = list_bucket(bucket)
    manifest = load_manifest(bucket, mdir)
    stats = {"remote_objects": len(remote), "remote_bytes": sum(f["size"] for f in remote),
             "downloaded": 0, "skipped": 0, "failed": []}
    new_manifest = {}
    for obj in remote:
        path = obj["path"]
        dest = os.path.join(bdir, bucket, *path.split("/"))
        prev = manifest.get(path)
        local_ok = (os.path.exists(dest) and os.path.getsize(dest) == obj["size"]
                    and prev and prev.get("size") == obj["size"]
                    and (not obj["etag"] or prev.get("etag") == obj["etag"]))
        if local_ok:
            stats["skipped"] += 1
            new_manifest[path] = {"size": obj["size"], "etag": obj["etag"]}
            continue
        ok, nbytes = download_object(bucket, path, dest)
        if ok:
            stats["downloaded"] += 1
            new_manifest[path] = {"size": nbytes, "etag": obj["etag"]}
        else:
            stats["failed"].append(path)
    save_manifest(bucket, mdir, new_manifest)
    log(f"Bucket {bucket}: {stats['remote_objects']} obj ({stats['remote_bytes']} B) — "
        f"descargados {stats['downloaded']}, omitidos {stats['skipped']}, fallidos {len(stats['failed'])}")
    return remote, stats


def verify_bucket(bucket, bdir, remote, stats):
    if stats["failed"]:
        log(f"VERIFICACIÓN {bucket}: FALLIDA (quedaron descargas fallidas)")
        stats["verified"] = False
        return False
    missing, mismatch = [], []
    total = 0
    for obj in remote:
        dest = os.path.join(bdir, bucket, *obj["path"].split("/"))
        if not os.path.exists(dest):
            missing.append(obj["path"])
        elif os.path.getsize(dest) != obj["size"]:
            mismatch.append(obj["path"])
        total += obj["size"]
    stats["verified"] = not missing and not mismatch
    stats["verify_missing"] = missing
    stats["verify_mismatch"] = mismatch
    stats["verify_bytes"] = total
    log(f"VERIFICACIÓN {bucket}: {'OK' if stats['verified'] else f'FALLA (faltan {len(missing)}, tamaño {len(mismatch)})'} "
        f"({len(remote)} obj, {total} B)")
    return stats["verified"]


REF_COLUMNS = [
    ("users", "avatar_path", None),
    ("asset_files", "storage_path", None),
    ("warranties", "document_path", None),
    ("wo_evidence", "storage_path", None),
    ("wo_comments", "attachment_path", None),
    ("items", "image_path", None),
    ("items", "technical_sheet_path", None),
    ("provider_files", "path", None),
    ("contracts", "document_path", None),
    ("certifications", "document_path", None),
    ("certification_history", "document_path", None),
    ("measurement_records", "evidence_path", None),
    ("report_send_log", "file_path", "reportes/"),
]


def fetch_referenced():
    referenced = set()
    for table, col, prefix in REF_COLUMNS:
        try:
            rows = req_json(f"/rest/v1/{table}?select={col}&{col}=not.is.null&limit=10000")
        except Exception as e:
            log(f"  WARN no se pudo leer {table}.{col}: {e}")
            continue
        for row in rows or []:
            val = row.get(col)
            if not val:
                continue
            referenced.add((prefix or "") + val)
    log(f"Referencias activas: {len(referenced)} paths")
    return referenced


def collect_candidates(all_remote, referenced):
    now = datetime.now(timezone.utc)
    orphans, retention = [], []
    for bucket, files in all_remote.items():
        for obj in files:
            full = f"{bucket}/{obj['path']}"
            if full not in referenced:
                orphans.append({"bucket": bucket, "path": obj["path"], "size": obj["size"],
                                "created_at": obj["created_at"]})
            if bucket == RETENTION_BUCKET and obj["created_at"]:
                try:
                    created = datetime.fromisoformat(obj["created_at"].replace("Z", "+00:00"))
                    age = (now - created).days
                    if age > RETENTION_DAYS:
                        retention.append({"bucket": bucket, "path": obj["path"], "size": obj["size"],
                                          "created_at": obj["created_at"], "age_days": age})
                except Exception:
                    pass
    return orphans, retention


def collect_broken(all_remote, referenced):
    local_paths = {f"{b}/{o['path']}" for b, files in all_remote.items() for o in files}
    broken = []
    for ref in sorted(referenced):
        if ref not in local_paths:
            broken.append(ref)
    return broken


def delete_objects(items):
    by_bucket = {}
    for it in items:
        by_bucket.setdefault(it["bucket"], []).append(it["path"])
    deleted = 0
    for bucket, paths in by_bucket.items():
        for i in range(0, len(paths), DELETE_BATCH):
            batch = paths[i:i + DELETE_BATCH]
            status, body = req(f"/storage/v1/object/{bucket}", method="DELETE",
                               data={"prefixes": batch})
            if status == 200:
                deleted += len(batch)
                log(f"  Borrados {len(batch)} de {bucket}")
            else:
                log(f"  ERROR borrado {bucket}: {status} {body[:200]!r}")
    return deleted


def main():
    parser = argparse.ArgumentParser(description="Backup de Storage + purga semi-manual")
    parser.add_argument("--apply", action="store_true", help="purgar candidatos del reporte")
    parser.add_argument("--report", help="archivo reporte JSON (requerido con --apply)")
    args = parser.parse_args()

    if not URL or not SERVICE:
        print("Falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY (.env.local / env)", file=sys.stderr)
        return 1

    ts = datetime.now().strftime("%Y%m%d-%H%M%S")

    if args.apply:
        if not args.report or not os.path.exists(args.report):
            print("--apply requiere --report <archivo.json> existente", file=sys.stderr)
            return 1
        report = json.load(open(args.report, encoding="utf-8"))
        orphans = report.get("orphans", [])
        retention = report.get("retention_candidates", [])
        failed_buckets = {b for b, s in report.get("backup", {}).get("buckets", {}).items()
                          if not s.get("verified")}
        purge_orphans = [o for o in orphans if o["bucket"] not in failed_buckets]
        purge_retention = [r for r in retention if r["bucket"] not in failed_buckets]
        log(f"APPLY sobre {args.report}: huérfanos {len(purge_orphans)}, retención {len(purge_retention)}"
            + (f" (buckets sin verificar excluidos: {sorted(failed_buckets)})" if failed_buckets else ""))
        if failed_buckets:
            log("ABORTADO parcial: hay buckets con verificación fallida — re-ejecuta el backup primero.")
            return 1
        n = delete_objects(purge_orphans + purge_retention)
        log(f"APPLY completado: {n} objetos borrados.")
        return 0

    if not BACKUP_DIR:
        print("Falta BACKUP_DIR (.env.local o env) — carpeta destino del espejo", file=sys.stderr)
        return 1

    bdir = BACKUP_DIR
    mdir = os.path.join(bdir, ".manifests")
    logs_dir = os.path.join(bdir, "logs")
    reports_dir = os.path.join(bdir, "reports")
    for d in (mdir, logs_dir, reports_dir):
        os.makedirs(d, exist_ok=True)

    log(f"=== Backup Storage {ts} → {bdir} (retención {RETENTION_DAYS}d, bucket {RETENTION_BUCKET}) ===")
    all_remote, backup_stats = {}, {}
    any_fail = False
    for bucket in BUCKETS:
        try:
            remote, stats = backup_bucket(bucket, bdir, mdir)
            all_remote[bucket] = remote
            backup_stats[bucket] = stats
            if not verify_bucket(bucket, bdir, remote, stats):
                any_fail = True
        except Exception as e:
            log(f"ERROR bucket {bucket}: {e}")
            backup_stats[bucket] = {"remote_objects": 0, "remote_bytes": 0, "downloaded": 0,
                                    "skipped": 0, "failed": [str(e)], "verified": False}
            all_remote[bucket] = []
            any_fail = True

    referenced = fetch_referenced()
    orphans, retention = collect_candidates(all_remote, referenced)
    broken = collect_broken(all_remote, referenced)
    log(f"Candidatos: huérfanos {len(orphans)}, retención>{RETENTION_DAYS}d {len(retention)}, "
        f"referencias rotas {len(broken)} (informativo)")

    report = {
        "generated_at": ts,
        "retention_days": RETENTION_DAYS,
        "backup": {"buckets": backup_stats},
        "orphans": orphans,
        "retention_candidates": retention,
        "broken_references": broken,
    }
    report_path = os.path.join(reports_dir, f"backup-report-{ts}.json")
    with open(report_path, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False)
    log(f"Reporte: {report_path}")
    log("Dry-run: nada borrado. Revisa el reporte y ejecuta con --apply --report <archivo> para purgar.")

    log_path = os.path.join(logs_dir, f"backup-{ts}.log")
    with open(log_path, "w", encoding="utf-8") as f:
        f.write("\n".join(LOG_LINES) + "\n")

    return 1 if any_fail else 0


if __name__ == "__main__":
    sys.exit(main())
