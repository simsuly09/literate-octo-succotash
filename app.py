import csv
import json
import math
import os
import uuid
from datetime import datetime

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
CSV_PATH = os.path.join(DATA_DIR, "leaderboard.csv")
CSV_FIELDS = ["id", "timestamp", "nickname", "accuracy", "points"]


def _write_all(rows):
    # utf-8-sig keeps the file UTF-8 while letting Excel detect the encoding.
    with open(CSV_PATH, "w", newline="", encoding="utf-8-sig") as f:
        w = csv.DictWriter(f, fieldnames=CSV_FIELDS)
        w.writeheader()
        for r in rows:
            w.writerow({k: r.get(k, "") for k in CSV_FIELDS})


def ensure_csv():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(CSV_PATH):
        _write_all([])
        return
    # Migrate older files (different columns, e.g. with consent/contact).
    with open(CSV_PATH, "r", newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        try:
            header = next(reader)
        except StopIteration:
            header = []
    if header != CSV_FIELDS:
        rows = []
        with open(CSV_PATH, "r", newline="", encoding="utf-8-sig") as f:
            for r in csv.DictReader(f):
                if not r.get("id"):
                    r["id"] = uuid.uuid4().hex
                rows.append(r)
        _write_all(rows)


def downsample(points, max_points=200):
    if len(points) <= max_points:
        return points
    step = len(points) / max_points
    return [points[min(len(points) - 1, int(i * step))] for i in range(max_points)]


def normalize_points(points):
    pts = downsample(points)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    min_x, min_y = min(xs), min(ys)
    span = max(max(xs) - min_x, max(ys) - min_y) or 1.0
    return [[round((x - min_x) / span, 4), round((y - min_y) / span, 4)] for x, y in pts]


def fit_circle(points):
    """Least-squares (Kåsa) circle fit. Returns (cx, cy, r) or None."""
    n = len(points)
    mx = sum(p[0] for p in points) / n
    my = sum(p[1] for p in points) / n
    suu = suv = svv = suuu = svvv = suvv = svuu = 0.0
    for x, y in points:
        u = x - mx
        v = y - my
        suu += u * u
        suv += u * v
        svv += v * v
        suuu += u * u * u
        svvv += v * v * v
        suvv += u * v * v
        svuu += v * u * u
    det = suu * svv - suv * suv
    if abs(det) < 1e-9:
        return None
    bu = 0.5 * (suuu + suvv)
    bv = 0.5 * (svvv + svuu)
    uc = (bu * svv - bv * suv) / det
    vc = (suu * bv - suv * bu) / det
    r = math.sqrt(max(0.0, uc * uc + vc * vc + (suu + svv) / n))
    return mx + uc, my + vc, r


def analyze(points):
    """Return (accuracy 0-100, circle dict|None) for a drawn point path.

    The reference circle is a least-squares best fit, so it lines up with
    the drawing instead of drifting toward dense parts of the stroke.
    """
    if not points or len(points) < 10:
        return 0.0, None

    n = len(points)
    fit = fit_circle(points)
    if fit is not None:
        cx, cy, r_fit = fit
    else:
        cx = sum(p[0] for p in points) / n
        cy = sum(p[1] for p in points) / n
        r_fit = None

    radii = [math.hypot(p[0] - cx, p[1] - cy) for p in points]
    r_mean = sum(radii) / n
    if r_mean < 1e-6:
        return 0.0, None
    radius = r_fit if r_fit else r_mean

    # roundness: low radius variation -> close to a circle.
    # The 0.45 denominator makes scoring ~10% more sensitive to deviation
    # than the previous 0.5.
    stddev = math.sqrt(sum((r - r_mean) ** 2 for r in radii) / n)
    cv = stddev / r_mean
    roundness = max(0.0, 1.0 - cv / 0.45)

    gap = math.hypot(points[0][0] - points[-1][0], points[0][1] - points[-1][1])
    closure = max(0.0, 1.0 - gap / r_mean)

    angles = [math.atan2(p[1] - cy, p[0] - cx) for p in points]
    total = 0.0
    for i in range(1, n):
        d = angles[i] - angles[i - 1]
        while d > math.pi:
            d -= 2 * math.pi
        while d < -math.pi:
            d += 2 * math.pi
        total += d
    coverage = min(1.0, abs(total) / (2 * math.pi))

    score = 100.0 * (0.6 * roundness + 0.2 * closure + 0.2 * coverage)
    score = round(max(0.0, min(100.0, score)), 3)
    circle = {"cx": round(cx, 2), "cy": round(cy, 2), "r": round(radius, 2)}
    return score, circle


def comment_for(accuracy):
    if accuracy >= 90:
        return "당신은 컴퍼스인가요?!"
    if accuracy >= 80:
        return "거의 완벽해요, 놀라운 솜씨!"
    if accuracy >= 70:
        return "아주 동그랗네요!"
    if accuracy >= 60:
        return "꽤 동그래요!"
    if accuracy >= 50:
        return "제법 원에 가까워요"
    if accuracy >= 40:
        return "음, 원의 느낌은 나요"
    if accuracy >= 30:
        return "원이라고 우길 수는 있어요"
    if accuracy >= 20:
        return "살짝 많이 찌그러졌어요"
    if accuracy >= 10:
        return "이건... 감자인가요?"
    return "이것은... 추상화인가요?"


def read_rows():
    ensure_csv()
    with open(CSV_PATH, "r", newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


def parse_points(raw_points):
    points = []
    for p in raw_points:
        if isinstance(p, (list, tuple)) and len(p) >= 2:
            try:
                points.append([float(p[0]), float(p[1])])
            except (ValueError, TypeError):
                pass
    return points


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/leaderboard")
def leaderboard():
    entries = []
    for r in read_rows():
        try:
            acc = float(r["accuracy"])
        except (ValueError, KeyError, TypeError):
            continue
        entries.append({
            "nickname": r.get("nickname", ""),
            "accuracy": acc,
            "points": r.get("points", ""),
        })
    entries.sort(key=lambda e: e["accuracy"], reverse=True)

    result = []
    for i, e in enumerate(entries):
        rank = i + 1
        item = {"rank": rank, "nickname": e["nickname"], "accuracy": e["accuracy"], "points": None}
        if rank <= 3 and e["points"]:
            try:
                item["points"] = json.loads(e["points"])
            except (ValueError, TypeError):
                item["points"] = None
        result.append(item)
    return jsonify({"entries": result})


@app.route("/api/stats")
def stats():
    today = datetime.now().date().isoformat()
    accs = []
    today_accs = []
    for r in read_rows():
        try:
            a = float(r["accuracy"])
        except (ValueError, KeyError, TypeError):
            continue
        accs.append(a)
        if str(r.get("timestamp", ""))[:10] == today:
            today_accs.append(a)
    return jsonify({
        "count": len(accs),
        "best": round(max(accs), 3) if accs else None,
        "today_best": round(max(today_accs), 3) if today_accs else None,
    })


@app.route("/api/submit", methods=["POST"])
def submit():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "invalid json"}), 400

    raw_points = data.get("points", [])
    if not isinstance(raw_points, list):
        return jsonify({"error": "points must be a list"}), 400
    points = parse_points(raw_points)
    accuracy, circle = analyze(points)

    register = bool(data.get("register", False))

    # Not registering for the hall of fame: just score it, don't store anything.
    if not register:
        return jsonify({
            "accuracy": accuracy,
            "rank": None,
            "total": None,
            "comment": comment_for(accuracy),
            "circle": circle,
            "registered": False,
        })

    nickname = str(data.get("nickname", "")).strip()[:20]
    if not nickname:
        return jsonify({"error": "nickname required"}), 400

    norm = normalize_points(points) if points else []
    row = {
        "id": uuid.uuid4().hex,
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "nickname": nickname,
        "accuracy": accuracy,
        "points": json.dumps(norm, separators=(",", ":")),
    }

    ensure_csv()
    # Append in plain utf-8: the file already has a BOM at the start,
    # we don't want a second one in the middle.
    with open(CSV_PATH, "a", newline="", encoding="utf-8") as f:
        csv.DictWriter(f, fieldnames=CSV_FIELDS).writerow(row)
    with open(CSV_PATH, "r", newline="", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))

    accs = []
    for r in rows:
        try:
            accs.append(float(r["accuracy"]))
        except (ValueError, KeyError, TypeError):
            pass
    rank = sum(1 for a in accs if a > accuracy) + 1

    return jsonify({
        "accuracy": accuracy,
        "rank": rank,
        "total": len(accs),
        "comment": comment_for(accuracy),
        "circle": circle,
        "registered": True,
    })


if __name__ == "__main__":
    ensure_csv()
    # Local single-device app: bind to localhost only.
    app.run(host="127.0.0.1", port=5000, debug=False)
