"""Qdrant snapshots over its REST API, standard library only (it runs inside the backend container: python -c "$(cat this file)" <command>).

  list                   one line per collection:  <name> <points>
  count <collection>     the number of points
  export <collection>    makes a snapshot, writes its bytes to stdout, then deletes it from the server
  import <collection>    reads a snapshot from stdin and recovers the collection from it (the snapshot replaces what is there)

The server comes from QDRANT_URL, or QDRANT_HOST + QDRANT_PORT (default port 6333); QDRANT_API_KEY is sent when set.
"""
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import uuid

BASE = os.environ.get("QDRANT_URL") or "http://%s:%s" % (os.environ.get("QDRANT_HOST", "localhost"), os.environ.get("QDRANT_PORT", "6333"))
KEY = os.environ.get("QDRANT_API_KEY", "")
BASE = BASE.rstrip("/")


def request(method, path, body=None, headers=None, timeout=3600):
    h = dict(headers or {})
    if KEY:
        h["api-key"] = KEY
    req = urllib.request.Request(BASE + path, data=body, method=method, headers=h)
    try:
        return urllib.request.urlopen(req, timeout=timeout)
    except urllib.error.HTTPError as e:
        sys.stderr.write("Qdrant answered %s %s: %s\n" % (e.code, path, e.read()[:500].decode("utf-8", "replace")))
        raise SystemExit(2)


def as_json(resp):
    with resp:
        return json.loads(resp.read().decode("utf-8"))


def collections():
    return [c["name"] for c in as_json(request("GET", "/collections"))["result"]["collections"]]


def points(name):
    return as_json(request("GET", "/collections/%s" % urllib.parse.quote(name)))["result"]["points_count"]


def export(name):
    q = urllib.parse.quote(name)
    snap = as_json(request("POST", "/collections/%s/snapshots?wait=true" % q))["result"]["name"]
    try:
        with request("GET", "/collections/%s/snapshots/%s" % (q, urllib.parse.quote(snap))) as resp:
            out = sys.stdout.buffer
            while True:
                chunk = resp.read(1024 * 1024)
                if not chunk:
                    break
                out.write(chunk)
            out.flush()
    finally:
        try:
            request("DELETE", "/collections/%s/snapshots/%s?wait=true" % (q, urllib.parse.quote(snap))).close()
        except SystemExit:
            sys.stderr.write("could not delete the temporary snapshot %s on the server\n" % snap)


def import_(name):
    data = sys.stdin.buffer.read()
    if not data:
        raise SystemExit("no snapshot data on stdin")
    boundary = uuid.uuid4().hex
    head = ('--%s\r\nContent-Disposition: form-data; name="snapshot"; filename="%s.snapshot"\r\n'
            "Content-Type: application/octet-stream\r\n\r\n" % (boundary, name)).encode()
    body = head + data + ("\r\n--%s--\r\n" % boundary).encode()
    request("POST", "/collections/%s/snapshots/upload?wait=true&priority=snapshot" % urllib.parse.quote(name), body=body,
            headers={"Content-Type": "multipart/form-data; boundary=%s" % boundary}).close()


def main(argv):
    cmd = argv[0] if argv else ""
    if cmd == "list":
        for n in collections():
            print(n, points(n))
    elif cmd == "count" and len(argv) == 2:
        print(points(argv[1]))
    elif cmd == "export" and len(argv) == 2:
        export(argv[1])
    elif cmd == "import" and len(argv) == 2:
        import_(argv[1])
    else:
        raise SystemExit(__doc__)


main(sys.argv[1:])
