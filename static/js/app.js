(function () {
  "use strict";

  var screens = {
    main: document.getElementById("screen-main"),
    nickname: document.getElementById("screen-nickname"),
    draw: document.getElementById("screen-draw"),
    result: document.getElementById("screen-result"),
  };

  var session = { nickname: "", consent: false, contact: "" };
  var drawState = newDrawState();

  function newDrawState() {
    return { points: [], drawing: false, finished: false, timerId: null, timeLeft: 30 };
  }

  function showScreen(name) {
    Object.keys(screens).forEach(function (key) {
      screens[key].classList.toggle("hidden", key !== name);
    });
  }

  /* ---------- 명예의 전당 ---------- */

  function loadLeaderboard() {
    fetch("/api/leaderboard")
      .then(function (res) { return res.json(); })
      .then(function (data) { renderLeaderboard(data.entries || []); })
      .catch(function () { renderLeaderboard([]); });
  }

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
    // 시상대 배치 순서: 2등 - 1등 - 3등
    [top3[1], top3[0], top3[2]].forEach(function (entry) {
      if (entry) podium.appendChild(buildPodiumSlot(entry));
    });

    entries.slice(3).forEach(function (entry) {
      var li = document.createElement("li");
      li.className = "rank-row";

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

  /* ---------- 닉네임 화면 ---------- */

  var consentBox = document.getElementById("input-consent");
  var contactWrap = document.getElementById("contact-wrap");

  consentBox.addEventListener("change", function () {
    contactWrap.classList.toggle("hidden", !consentBox.checked);
  });

  document.getElementById("btn-start").addEventListener("click", function () {
    showScreen("nickname");
  });

  document.getElementById("btn-back-main").addEventListener("click", function () {
    showScreen("main");
    loadLeaderboard();
  });

  document.getElementById("btn-confirm").addEventListener("click", function () {
    var nickname = document.getElementById("input-nickname").value.trim();
    if (!nickname) {
      alert("닉네임을 입력해 주세요.");
      return;
    }
    var consent = consentBox.checked;
    var contact = consent ? document.getElementById("input-contact").value.trim() : "";
    if (consent && !contact) {
      alert("연락처를 입력해 주세요.");
      return;
    }
    session = { nickname: nickname, consent: consent, contact: contact };
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
    sizeCanvas(canvas);
    drawState = newDrawState();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    document.getElementById("timer").textContent = "30";

    drawState.timerId = setInterval(function () {
      drawState.timeLeft -= 1;
      document.getElementById("timer").textContent = String(Math.max(0, drawState.timeLeft));
      if (drawState.timeLeft <= 0) finishDraw();
    }, 1000);
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
    submitResult();
  }

  /* ---------- 결과 화면 ---------- */

  function submitResult() {
    var payload = {
      nickname: session.nickname,
      consent: session.consent,
      contact: session.contact,
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

  function renderResultCanvas() {
    var rc = document.getElementById("result-canvas");
    rc.width = canvas.width;
    rc.height = canvas.height;
    var rctx = rc.getContext("2d");
    rctx.clearRect(0, 0, rc.width, rc.height);

    var pts = drawState.points;
    if (pts.length < 2) return;

    // 사용자가 그린 원
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

    // 완벽한 원을 반투명(30%)하게 오버레이
    var n = pts.length;
    var cx = pts.reduce(function (s, p) { return s + p[0]; }, 0) / n;
    var cy = pts.reduce(function (s, p) { return s + p[1]; }, 0) / n;
    var rMean = pts.reduce(function (s, p) {
      return s + Math.hypot(p[0] - cx, p[1] - cy);
    }, 0) / n;

    rctx.save();
    rctx.globalAlpha = 0.3;
    rctx.beginPath();
    rctx.arc(cx, cy, rMean, 0, 2 * Math.PI);
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
      data.rank ? "전체 " + data.total + "명 중 " + data.rank + "위" : "";
    renderResultCanvas();
  }

  document.getElementById("btn-again").addEventListener("click", function () {
    document.getElementById("input-nickname").value = "";
    document.getElementById("input-contact").value = "";
    consentBox.checked = false;
    contactWrap.classList.add("hidden");
    session = { nickname: "", consent: false, contact: "" };
    showScreen("main");
    loadLeaderboard();
  });

  /* ---------- 시작 ---------- */
  showScreen("main");
  loadLeaderboard();
})();
