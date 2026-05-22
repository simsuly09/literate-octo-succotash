(function () {
  "use strict";

  var TIME_LIMIT = 20;

  var screens = {
    main: document.getElementById("screen-main"),
    hall: document.getElementById("screen-hall"),
    nickname: document.getElementById("screen-nickname"),
    draw: document.getElementById("screen-draw"),
    result: document.getElementById("screen-result"),
  };

  var session = { register: false, nickname: "" };
  var drawState = newDrawState();
  var stopFireworks = null;

  function newDrawState() {
    return { points: [], drawing: false, finished: false, timerId: null, timeLeft: TIME_LIMIT };
  }

  function showScreen(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].classList.toggle("hidden", key !== name);
    });
    if (stopFireworks && name !== "hall") {
      stopFireworks();
      stopFireworks = null;
    }
    if (name === "main") loadStats();
  }

  function loadStats() {
    fetch("/api/stats")
      .then(function (res) { return res.json(); })
      .then(function (d) {
        document.getElementById("stat-count").textContent = d.count;
        document.getElementById("stat-best").textContent =
          d.best != null ? d.best.toFixed(1) : "-";
        document.getElementById("stat-today").textContent =
          d.today_best != null ? d.today_best.toFixed(1) : "-";
      })
      .catch(function () {});
  }

  /* ---------- 폭죽 ---------- */

  function startFireworks(canvas) {
    var ctx = canvas.getContext("2d");
    var rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(200, Math.floor(rect.width));
    canvas.height = Math.max(200, Math.floor(rect.height));
    var particles = [];
    var running = true;

    function spawn() {
      var x = Math.random() * canvas.width;
      var y = 40 + Math.random() * (canvas.height * 0.55);
      var hue = Math.floor(Math.random() * 360);
      var count = 28;
      for (var i = 0; i < count; i++) {
        var angle = (Math.PI * 2 * i) / count;
        var speed = 1.4 + Math.random() * 2.2;
        particles.push({
          x: x, y: y,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          life: 1,
          hue: hue,
        });
      }
    }

    function tick() {
      if (!running) return;
      ctx.fillStyle = "rgba(24, 25, 29, 0.25)";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      if (Math.random() < 0.05) spawn();
      var next = [];
      for (var i = 0; i < particles.length; i++) {
        var p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.045;
        p.life -= 0.016;
        if (p.life > 0) {
          ctx.beginPath();
          ctx.arc(p.x, p.y, 2.4, 0, Math.PI * 2);
          ctx.fillStyle = "hsla(" + p.hue + ", 95%, 62%, " + Math.max(0, p.life) + ")";
          ctx.fill();
          next.push(p);
        }
      }
      particles = next;
      requestAnimationFrame(tick);
    }
    spawn();
    tick();
    return function stop() { running = false; };
  }

  /* ---------- 명예의 전당 ---------- */

  function drawCirclePath(ctx, points, size, color, lineWidth) {
    if (!points || points.length < 2) return;
    var pad = lineWidth + 2;
    ctx.beginPath();
    points.forEach(function (p, i) {
      var x = pad + p[0] * (size - 2 * pad);
      var y = pad + p[1] * (size - 2 * pad);
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function makeMedal(rank) {
    var el = document.createElement("div");
    el.className = "medal medal-" + rank;
    el.textContent = rank;
    return el;
  }

  function buildPodiumSlot(entry) {
    var slot = document.createElement("div");
    slot.className = "podium-slot rank-" + entry.rank;

    slot.appendChild(makeMedal(entry.rank));

    var canvas = document.createElement("canvas");
    canvas.width = 90;
    canvas.height = 90;
    canvas.className = "thumb";
    slot.appendChild(canvas);

    var nick = document.createElement("div");
    nick.className = "podium-nick";
    nick.textContent = entry.nickname;
    slot.appendChild(nick);

    var acc = document.createElement("div");
    acc.className = "podium-acc";
    acc.textContent = entry.accuracy.toFixed(1) + "점";
    slot.appendChild(acc);

    var base = document.createElement("div");
    base.className = "podium-base";
    base.textContent = entry.rank;
    slot.appendChild(base);

    drawCirclePath(canvas.getContext("2d"), entry.points, 90, "#2563eb", 2);
    return slot;
  }

  function loadLeaderboard() {
    return fetch("/api/leaderboard")
      .then(function (res) { return res.json(); })
      .then(function (data) { renderLeaderboard(data.entries || []); })
      .catch(function () { renderLeaderboard([]); });
  }

  function renderLeaderboard(entries) {
    var podium = document.getElementById("podium");
    var list = document.getElementById("rank-list");
    var emptyMsg = document.getElementById("empty-msg");
    podium.innerHTML = "";
    list.innerHTML = "";

    if (entries.length === 0) {
      emptyMsg.classList.remove("hidden");
      return;
    }
    emptyMsg.classList.add("hidden");

    var top3 = entries.slice(0, 3);
    [top3[1], top3[0], top3[2]].forEach(function (entry) {
      if (entry) podium.appendChild(buildPodiumSlot(entry));
    });

    // 오른쪽 목록은 1위부터 마지막까지 전체 표시
    entries.forEach(function (entry) {
      var li = document.createElement("li");
      li.className = "rank-row" + (entry.rank <= 3 ? " top-" + entry.rank : "");

      var num = document.createElement("span");
      num.className = "rank-num";
      num.textContent = entry.rank;

      var nick = document.createElement("span");
      nick.className = "rank-nick";
      nick.textContent = entry.nickname;

      var acc = document.createElement("span");
      acc.className = "rank-acc";
      acc.textContent = entry.accuracy.toFixed(1) + "점";

      li.appendChild(num);
      li.appendChild(nick);
      li.appendChild(acc);
      list.appendChild(li);
    });
  }

  function openHall() {
    showScreen("hall");
    loadLeaderboard().then(function () {
      var canvas = document.getElementById("fireworks");
      if (stopFireworks) stopFireworks();
      stopFireworks = startFireworks(canvas);
    });
  }

  /* ---------- 메인 화면 ---------- */

  document.getElementById("btn-start").addEventListener("click", function () {
    showScreen("nickname");
  });
  document.getElementById("btn-hall").addEventListener("click", openHall);
  document.getElementById("btn-hall-back").addEventListener("click", function () {
    showScreen("main");
  });

  /* ---------- 등록 화면 ---------- */

  var registerBox = document.getElementById("input-register");
  var nicknameWrap = document.getElementById("nickname-wrap");

  registerBox.addEventListener("change", function () {
    nicknameWrap.classList.toggle("hidden", !registerBox.checked);
    if (!registerBox.checked) {
      document.getElementById("input-nickname").value = "";
    }
  });

  document.getElementById("btn-back-main").addEventListener("click", function () {
    showScreen("main");
  });

  document.getElementById("btn-confirm").addEventListener("click", function () {
    var register = registerBox.checked;
    var nickname = "";
    if (register) {
      nickname = document.getElementById("input-nickname").value.trim();
      if (!nickname) {
        alert("닉네임을 입력해 주세요.");
        return;
      }
    }
    session = { register: register, nickname: nickname };
    startDraw();
  });

  /* ---------- 그리기 화면 ---------- */

  var canvas = document.getElementById("draw-canvas");
  var ctx = canvas.getContext("2d");

  function sizeCanvas(el) {
    var size = Math.min(window.innerWidth - 40, 360);
    el.width = size;
    el.height = size;
    return size;
  }

  function startDraw() {
    showScreen("draw");
    resetDrawAttempt();
  }

  function resetDrawAttempt() {
    sizeCanvas(canvas);
    drawState = newDrawState();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    document.getElementById("timer").textContent = String(TIME_LIMIT);

    drawState.timerId = setInterval(function () {
      drawState.timeLeft -= 1;
      document.getElementById("timer").textContent = String(Math.max(0, drawState.timeLeft));
      if (drawState.timeLeft <= 0) finishDraw();
    }, 1000);
  }

  function isLargeEnough(points) {
    if (!points || points.length < 2) return false;
    var minX = points[0][0], maxX = points[0][0];
    var minY = points[0][1], maxY = points[0][1];
    for (var i = 1; i < points.length; i++) {
      var x = points[i][0], y = points[i][1];
      if (x < minX) minX = x; else if (x > maxX) maxX = x;
      if (y < minY) minY = y; else if (y > maxY) maxY = y;
    }
    var minSide = canvas.width * 0.25;
    return (maxX - minX) >= minSide && (maxY - minY) >= minSide;
  }

  function getPos(e) {
    var rect = canvas.getBoundingClientRect();
    var source = (e.touches && e.touches.length) ? e.touches[0] : e;
    return [source.clientX - rect.left, source.clientY - rect.top];
  }

  function pointerDown(e) {
    if (drawState.finished) return;
    e.preventDefault();
    drawState.drawing = true;
    var p = getPos(e);
    drawState.points.push(p);
    ctx.beginPath();
    ctx.moveTo(p[0], p[1]);
  }

  function pointerMove(e) {
    if (!drawState.drawing || drawState.finished) return;
    e.preventDefault();
    var p = getPos(e);
    drawState.points.push(p);
    ctx.lineTo(p[0], p[1]);
    ctx.strokeStyle = "#2563eb";
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.stroke();
  }

  function pointerUp(e) {
    if (!drawState.drawing || drawState.finished) return;
    e.preventDefault();
    drawState.drawing = false;
    finishDraw();
  }

  canvas.addEventListener("mousedown", pointerDown);
  canvas.addEventListener("mousemove", pointerMove);
  window.addEventListener("mouseup", pointerUp);
  canvas.addEventListener("touchstart", pointerDown, { passive: false });
  canvas.addEventListener("touchmove", pointerMove, { passive: false });
  canvas.addEventListener("touchend", pointerUp, { passive: false });

  function finishDraw() {
    if (drawState.finished) return;
    drawState.finished = true;
    if (drawState.timerId) {
      clearInterval(drawState.timerId);
      drawState.timerId = null;
    }
    if (!isLargeEnough(drawState.points)) {
      alert("원이 충분히 크지 않습니다. 다시 그려주세요.");
      resetDrawAttempt();
      return;
    }
    submitResult();
  }

  /* ---------- 결과 화면 ---------- */

  function submitResult() {
    var payload = {
      register: session.register,
      nickname: session.nickname,
      points: drawState.points,
    };
    fetch("/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) { return res.json(); })
      .then(function (data) { showResult(data); })
      .catch(function () {
        showResult({ accuracy: 0, comment: "결과를 저장하지 못했어요.", rank: null, total: 0 });
      });
  }

  function bestFitCircle(pts) {
    // Least-squares (Kåsa) fit, mirrors the server, used as a fallback
    // when the response doesn't carry circle data.
    var n = pts.length;
    var mx = 0, my = 0, i;
    for (i = 0; i < n; i++) { mx += pts[i][0]; my += pts[i][1]; }
    mx /= n; my /= n;
    var suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
    for (i = 0; i < n; i++) {
      var u = pts[i][0] - mx, v = pts[i][1] - my;
      suu += u * u; suv += u * v; svv += v * v;
      suuu += u * u * u; svvv += v * v * v;
      suvv += u * v * v; svuu += v * u * u;
    }
    var det = suu * svv - suv * suv;
    if (Math.abs(det) < 1e-9) return null;
    var bu = 0.5 * (suuu + suvv), bv = 0.5 * (svvv + svuu);
    var uc = (bu * svv - bv * suv) / det;
    var vc = (suu * bv - suv * bu) / det;
    var r = Math.sqrt(Math.max(0, uc * uc + vc * vc + (suu + svv) / n));
    return { cx: mx + uc, cy: my + vc, r: r };
  }

  function renderResultCanvas(circle) {
    var rc = document.getElementById("result-canvas");
    rc.width = canvas.width;
    rc.height = canvas.height;
    var rctx = rc.getContext("2d");
    rctx.clearRect(0, 0, rc.width, rc.height);

    var pts = drawState.points;
    if (pts.length < 2) return;

    rctx.beginPath();
    pts.forEach(function (p, i) {
      if (i === 0) rctx.moveTo(p[0], p[1]);
      else rctx.lineTo(p[0], p[1]);
    });
    rctx.strokeStyle = "#2563eb";
    rctx.lineWidth = 3;
    rctx.lineJoin = "round";
    rctx.lineCap = "round";
    rctx.stroke();

    // Prefer the server's best-fit circle so the reference matches the drawing.
    var c = (circle && isFinite(circle.r)) ? circle : bestFitCircle(pts);
    if (!c || !isFinite(c.r) || c.r <= 0) return;

    rctx.save();
    rctx.globalAlpha = 0.3;
    rctx.beginPath();
    rctx.arc(c.cx, c.cy, c.r, 0, 2 * Math.PI);
    rctx.fillStyle = "#ef4444";
    rctx.fill();
    rctx.restore();
  }

  function showResult(data) {
    showScreen("result");
    var accuracy = (typeof data.accuracy === "number") ? data.accuracy : 0;
    document.getElementById("result-accuracy").textContent =
      "정확도 " + accuracy.toFixed(1) + "점";
    document.getElementById("result-comment").textContent = data.comment || "";
    document.getElementById("result-rank").textContent =
      data.rank ? "전체 " + data.total + "명 중 " + data.rank + "위" : "명예의 전당에는 등록하지 않았어요";
    renderResultCanvas(data.circle);
  }

  document.getElementById("btn-again").addEventListener("click", function () {
    document.getElementById("input-nickname").value = "";
    registerBox.checked = false;
    nicknameWrap.classList.add("hidden");
    session = { register: false, nickname: "" };
    showScreen("main");
  });

  /* ---------- 시계 ---------- */

  function pad2(n) { return n < 10 ? "0" + n : "" + n; }

  function tickClock() {
    var d = new Date();
    var s =
      d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate()) +
      " " + pad2(d.getHours()) + ":" + pad2(d.getMinutes()) + ":" + pad2(d.getSeconds());
    document.getElementById("clock").textContent = s;
  }
  tickClock();
  setInterval(tickClock, 1000);

  /* ---------- 시작 ---------- */
  showScreen("main");
})();
