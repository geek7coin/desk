(function (global) {
  function sizeCanvas(canvas) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 358;
    const cssH = canvas.clientHeight || 220;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: cssW, h: cssH, dpr: dpr };
  }

  function drawLineChart(canvas, opts) {
    opts = opts || {};
    const sized = sizeCanvas(canvas);
    const ctx = sized.ctx, w = sized.w, h = sized.h;
    ctx.clearRect(0, 0, w, h);
    const points = (opts.points || []).map(function (p) {
      return { t: p.t, v: Number(p.v) };
    }).filter(function (p) { return !isNaN(p.v); });
    const marks = opts.marks || [];
    const start = opts.start;
    const padL = 8, padR = 8, padT = 28, padB = 18;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;

    function yAt(v, min, max) {
      if (max === min) return padT + innerH / 2;
      return padT + (1 - (v - min) / (max - min)) * innerH;
    }
    function xAt(i, n) {
      if (n <= 1) return padL + innerW / 2;
      return padL + (i / (n - 1)) * innerW;
    }

    const vals = points.map(function (p) { return p.v; });
    if (start != null && !isNaN(Number(start))) vals.push(Number(start));
    let min = vals.length ? Math.min.apply(null, vals) : 0;
    let max = vals.length ? Math.max.apply(null, vals) : 1;
    if (min === max) { min -= 1; max += 1; }

    if (start != null && !isNaN(Number(start))) {
      const y = yAt(Number(start), min, max);
      ctx.save();
      ctx.setLineDash([5, 5]);
      ctx.strokeStyle = "rgba(235,235,245,0.3)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.restore();
    }

    if (points.length >= 2) {
      const slide = opts.slide == null ? 1 : opts.slide;
      ctx.beginPath();
      for (let i = 0; i < points.length; i++) {
        const x = xAt(i, points.length);
        const y = yAt(points[i].v, min, max);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      if (slide < 1 && points.length > 1) {
        const last = points.length - 1;
        const x0 = xAt(last - 1, points.length);
        const x1 = xAt(last, points.length);
        const y0 = yAt(points[last - 1].v, min, max);
        const y1 = yAt(points[last].v, min, max);
        const x = x0 + (x1 - x0) * slide;
        const y = y0 + (y1 - y0) * slide;
        ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "#00d35a";
      ctx.lineWidth = 2;
      ctx.stroke();
      const lastX = slide < 1 && points.length > 1
        ? xAt(points.length - 2, points.length) + (xAt(points.length - 1, points.length) - xAt(points.length - 2, points.length)) * slide
        : xAt(points.length - 1, points.length);
      ctx.lineTo(lastX, padT + innerH);
      ctx.lineTo(xAt(0, points.length), padT + innerH);
      ctx.closePath();
      const grad = ctx.createLinearGradient(0, padT, 0, padT + innerH);
      grad.addColorStop(0, "rgba(0,211,90,0.28)");
      grad.addColorStop(1, "rgba(0,211,90,0)");
      ctx.fillStyle = grad;
      ctx.fill();
    }

    const colors = { blue: "#0a84ff", green: "#00d35a", red: "#ff453a" };
    const placed = [];
    const fade = opts.markFade == null ? 1 : opts.markFade;
    marks.forEach(function (mark) {
      if (!points.length) return;
      let idx = 0;
      let best = Infinity;
      points.forEach(function (p, i) {
        const d = Math.abs(Date.parse(p.t) - Date.parse(mark.t || 0));
        if (!isNaN(d) && d < best) { best = d; idx = i; }
      });
      const x = xAt(idx, points.length);
      const y = yAt(points[idx].v, min, max);
      let row = 0;
      let labelY = y - 14;
      function overlaps(xx, yy) {
        return placed.some(function (p) {
          return Math.abs(p.x - xx) < 64 && Math.abs(p.y - yy) < 14;
        });
      }
      while (overlaps(x, labelY) && row < 6) {
        row += 1;
        labelY -= 14;
      }
      placed.push({ x: x, y: labelY });
      ctx.save();
      ctx.globalAlpha = fade;
      ctx.fillStyle = colors[mark.color] || "#fff";
      ctx.font = "11px ui-sans-serif, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(mark.label || ""), x, Math.max(12, labelY));
      ctx.restore();
    });
  }

  function pad2(n) { return (n < 10 ? "0" : "") + n; }

  function minuteKey(d) {
    return d.getFullYear() + "-" + pad2(d.getMonth() + 1) + "-" + pad2(d.getDate())
      + "T" + pad2(d.getHours()) + ":" + pad2(d.getMinutes());
  }

  function parseMinute(stamp) {
    const text = String(stamp);
    const iso = text.length >= 16 ? text.slice(0, 16) + ":00" : text;
    const d = new Date(iso);
    return isNaN(d.getTime()) ? null : d;
  }

  function addMinute(stamp) {
    const d = parseMinute(stamp);
    if (!d) return null;
    d.setMinutes(d.getMinutes() + 1);
    return minuteKey(d);
  }

  function fillCandleGaps(raw) {
    const src = (raw || []).filter(function (c) { return c && c.t != null; }).slice();
    src.sort(function (a, b) {
      return String(a.t) < String(b.t) ? -1 : String(a.t) > String(b.t) ? 1 : 0;
    });
    if (!src.length) return [];
    const firstReal = String(src[0].t).slice(0, 16);
    const lastReal = String(src[src.length - 1].t).slice(0, 16);
    const nowKey = minuteKey(new Date());
    const end = nowKey >= lastReal ? nowKey : lastReal;
    const endDate = parseMinute(end);
    if (!endDate) return src.slice();
    const sixtyDate = new Date(endDate.getTime());
    sixtyDate.setMinutes(sixtyDate.getMinutes() - 60);
    const sixtyKey = minuteKey(sixtyDate);
    const start = firstReal >= sixtyKey ? firstReal : sixtyKey;
    const byT = {};
    src.forEach(function (c) { byT[String(c.t).slice(0, 16)] = c; });
    let seed = null;
    for (let i = 0; i < src.length; i++) {
      if (String(src[i].t).slice(0, 16) <= start) seed = src[i];
      else break;
    }
    const out = [];
    let t = start;
    let lastClose = seed && Number.isFinite(Number(seed.c)) ? Number(seed.c) : null;
    let guard = 0;
    while (t && t <= end && guard < 2000) {
      const real = byT[t];
      if (real) {
        out.push(real);
        const close = Number(real.c);
        if (Number.isFinite(close)) lastClose = close;
      } else if (lastClose != null) {
        out.push({ t: t, o: lastClose, h: lastClose, l: lastClose, c: lastClose, volume: 0 });
      }
      t = addMinute(t);
      guard += 1;
    }
    return out;
  }

  function drawCandles(canvas, opts) {
    opts = opts || {};
    const sized = sizeCanvas(canvas);
    const ctx = sized.ctx, w = sized.w, h = sized.h, dpr = sized.dpr;
    ctx.clearRect(0, 0, w, h);
    const candles = fillCandleGaps(opts.candles || []);
    if (!candles.length) return;
    const padL = 8, padR = 8, padT = 16, padB = 40;
    const innerW = w - padL - padR;
    const innerH = h - padT - padB;
    const highs = candles.map(function (c) { return Number(c.h); });
    const lows = candles.map(function (c) { return Number(c.l); });
    const hasExit = opts.exitLine != null && opts.exitLine !== "" && !isNaN(Number(opts.exitLine));
    if (hasExit) {
      highs.push(Number(opts.exitLine));
      lows.push(Number(opts.exitLine));
    }
    let min = Math.min.apply(null, lows);
    let max = Math.max.apply(null, highs);
    if (min === max) {
      const pad = Math.abs(min) * 0.01 || 1;
      min -= pad;
      max += pad;
    }
    function yAt(v) { return padT + (1 - (v - min) / (max - min)) * innerH; }
    function snap(v) { return Math.round(v * dpr) / dpr; }
    function px(v) { return Math.max(1 / dpr, Math.round(v * dpr) / dpr); }
    const slot = innerW / candles.length;
    const bodyW = Math.max(1 / dpr, slot * 0.6);
    const minBody = 1 / dpr;
    const volMax = Math.max.apply(null, candles.map(function (c) { return Math.abs(Number(c.volume) || 0); }).concat([0]));
    candles.forEach(function (c, i) {
      const o = Number(c.o), cl = Number(c.c), hi = Number(c.h), lo = Number(c.l);
      if (![o, cl, hi, lo].every(function (n) { return Number.isFinite(n); })) return;
      const up = cl >= o;
      ctx.fillStyle = up ? "#00d35a" : "#ff453a";
      const x = padL + i * slot + slot / 2;
      const yHigh = yAt(Math.max(hi, o, cl, lo));
      const yLow = yAt(Math.min(lo, o, cl, hi));
      ctx.fillRect(snap(x - minBody / 2), snap(yHigh), minBody, px(yLow - yHigh));
      let top = yAt(Math.max(o, cl));
      let bot = yAt(Math.min(o, cl));
      if (bot - top < minBody) {
        const mid = (top + bot) / 2;
        top = mid - minBody / 2;
        bot = mid + minBody / 2;
      }
      const bw = px(bodyW);
      ctx.fillRect(snap(x - bw / 2), snap(top), bw, px(bot - top));
      const vol = Math.abs(Number(c.volume) || 0);
      if (volMax > 0 && vol > 0) {
        const vh = (vol / volMax) * (padB - 8);
        ctx.globalAlpha = 0.45;
        ctx.fillRect(snap(x - bw / 2), snap(h - 4 - vh), bw, px(vh));
        ctx.globalAlpha = 1;
      }
    });
    if (hasExit) {
      const y = yAt(Number(opts.exitLine));
      ctx.save();
      ctx.setLineDash([5, 4]);
      ctx.strokeStyle = "#ff9f0a";
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(w - padR, y);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = "#ff9f0a";
      ctx.font = "11px ui-sans-serif, -apple-system, sans-serif";
      ctx.fillText("Risk trailing stop", padL, Math.max(12, y - 6));
      ctx.restore();
    }
  }

  function drawScoreRing(canvas, score, threshold) {
    const sized = sizeCanvas(canvas);
    const ctx = sized.ctx, w = sized.w, h = sized.h;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;
    const r = Math.min(w, h) / 2 - 8;
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#2c2c2e";
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    if (score == null || isNaN(Number(score))) {
      ctx.fillStyle = "rgba(235,235,245,0.6)";
      ctx.font = "600 20px ui-sans-serif, -apple-system, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText("—", cx, cy);
      return;
    }
    const value = Math.max(0, Math.min(100, Number(score)));
    const t = threshold == null ? 70 : Number(threshold);
    ctx.strokeStyle = value >= t ? "#00d35a" : "#ffd60a";
    ctx.beginPath();
    ctx.arc(cx, cy, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * value) / 100);
    ctx.stroke();
    ctx.fillStyle = "#fff";
    ctx.font = "600 22px ui-sans-serif, -apple-system, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(String(Math.round(value)), cx, cy);
  }

  global.drawLineChart = drawLineChart;
  global.drawCandles = drawCandles;
  global.drawScoreRing = drawScoreRing;
  global.drawChart = function (canvas, points) {
    drawLineChart(canvas, { points: points || [] });
  };
})(window);
