import csv
import json
import math
import os
import threading
from datetime import datetime

from flask import Flask, jsonify, render_template, request

app = Flask(__name__)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
CSV_PATH = os.path.join(DATA_DIR, "leaderboard.csv")
CSV_FIELDS = ["timestamp", "nickname", "accuracy", "consent", "contact", "points"]

# Serializes CSV reads/writes so concurrent submissions from multiple
# devices cannot interleave and corrupt the file.
_csv_lock = threading.Lock()


def ensure_csv():
    os.makedirs(DATA_DIR, exist_ok=True)
    if not os.path.exists(CSV_PATH):
        with open(CSV_PATH, "w", newline="", encoding="utf-8") as f:
            csv.DictWriter(f, fieldnames=CSV_FIELDS).writeheader()


def downsample(points, max_points=200):
    if len(points) <= max_points:
        return points
    step = len(points) / max_points
    return [points[min(len(points) - 1, int(i * step))] for i in range(max_points)]


def normalize_points(points):
    """Scale a point array into a unit box [0,1] x [0,1] for compact storage."""
    pts = downsample(points)
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    min_x, min_y = min(xs), min(ys)
    span = max(max(xs) - min_x, max(ys) - min_y) or 1.0
    return [[round((x - min_x) / span, 4), round((y - min_y) / span, 4)] for x, y in pts]


def compute_accuracy(points):
    """Score 0-100 for how close a drawn point path is to a perfect circle."""
    if not points or len(points) < 10:
        return 0.0

    n = len(points)
    cx = sum(p[0] for p in points) / n
    cy = sum(p[1] for p in points) / n
    radii = [math.hypot(p[0] - cx, p[1] - cy) for p in points]
    r_mean = sum(radii) / n
    if r_mean < 1e-6:
        return 0.0

    # roundness: low radius variation -> close to a circle
    stddev = math.sqrt(sum((r - r_mean) ** 2 for r in radii) / n)
    cv = stddev / r_mean
    roundness = max(0.0, 1.0 - cv / 0.5)

    # closure: small gap between the first and last point
    gap = math.hypot(points[0][0] - points[-1][0], points[0][1] - points[-1][1])
    closure = max(0.0, 1.0 - gap / r_mean)

    # coverage: did the stroke actually sweep a full turn
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
    return round(max(0.0, min(100.0, score)), 1)


def comment_for(accuracy):
    if accuracy >= 80:
        return "당신은 컴퍼스인가요?!"
    if accuracy >= 70:
        return "거의 완벽해요, 놀라운 솜씨!"
    if accuracy >= 50:
        return "꽤 동그랗네요!"
    if accuracy >= 30:
        return "음... 원의 형태는 갖췄어요"
    return "이것은... 추상화인가요?"


def read_rows():
    ensure_csv()
    with _csv_lock:
        with open(CSV_PATH, "r", newline="", encoding="utf-8") as f:
            return list(csv.DictReader(f))


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
        # Only the podium (top 3) needs the drawn-circle thumbnail data.
        if rank <= 3 and e["points"]:
            try:
                item["points"] = json.loads(e["points"])
            except (ValueError, TypeError):
                item["points"] = None
        result.append(item)
    return jsonify({"entries": result})


@app.route("/api/submit", methods=["POST"])
def submit():
    data = request.get_json(silent=True)
    if not isinstance(data, dict):
        return jsonify({"error": "invalid json"}), 400

    nickname = str(data.get("nickname", "")).strip()[:20]
    if not nickname:
        return jsonify({"error": "nickname required"}), 400

    consent = bool(data.get("consent", False))
    contact = str(data.get("contact", "")).strip()[:50] if consent else ""

    raw_points = data.get("points", [])
    if not isinstance(raw_points, list):
        return jsonify({"error": "points must be a list"}), 400

    points = []
    for p in raw_points:
        if isinstance(p, (list, tuple)) and len(p) >= 2:
            try:
                points.append([float(p[0]), float(p[1])])
            except (ValueError, TypeError):
                pass

    accuracy = compute_accuracy(points)
    norm = normalize_points(points) if points else []

    row = {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "nickname": nickname,
        "accuracy": accuracy,
        "consent": "1" if consent else "0",
        "contact": contact,
        "points": json.dumps(norm, separators=(",", ":")),
    }

    ensure_csv()
    with _csv_lock:
        with open(CSV_PATH, "a", newline="", encoding="utf-8") as f:
            csv.DictWriter(f, fieldnames=CSV_FIELDS).writerow(row)
        with open(CSV_PATH, "r", newline="", encoding="utf-8") as f:
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
    })


if __name__ == "__main__":
    ensure_csv()
    # threaded=True lets multiple devices play and submit concurrently.
    app.run(host="0.0.0.0", port=5000, threaded=True, debug=False)
