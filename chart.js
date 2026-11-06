(function (global) {
  function drawChart(canvas, points) {
    const ctx = canvas.getContext("2d");
    const dpr = window.devicePixelRatio || 1;
    const cssW = canvas.clientWidth || 358;
    const cssH = canvas.clientHeight || 180;
    canvas.width = Math.round(cssW * dpr);
    canvas.height = Math.round(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, cssW, cssH);
    ctx.fillStyle = "#10161d";
    ctx.fillRect(0, 0, cssW, cssH);
    if (!points || points.length < 2) {
      ctx.fillStyle = "#6b7785";
      ctx.font = "13px ui-sans-serif, system-ui, sans-serif";
      ctx.fillText("Waiting for PAPER chart…", 16, cssH / 2);
      return;
    }
    const vals = points.map(function (p) { return Number(p.v); });
    let min = Math.min.apply(null, vals);
    let max = Math.max.apply(null, vals);
    if (min === max) { min -= 1; max += 1; }
    const padL = 10, padR = 10, padT = 14, padB = 14;
    const w = cssW - padL - padR;
    const h = cssH - padT - padB;
    function xAt(i) { return padL + (i / (vals.length - 1)) * w; }
    function yAt(v) { return padT + (1 - (v - min) / (max - min)) * h; }
    ctx.strokeStyle = "#1c2530";
    ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const y = padT + (h / 3) * i;
      ctx.beginPath();
      ctx.moveTo(padL, y);
      ctx.lineTo(cssW - padR, y);
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(xAt(0), yAt(vals[0]));
    for (let i = 1; i < vals.length; i++) ctx.lineTo(xAt(i), yAt(vals[i]));
    ctx.strokeStyle = "#3dff8a";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.lineTo(xAt(vals.length - 1), padT + h);
    ctx.lineTo(xAt(0), padT + h);
    ctx.closePath();
    ctx.fillStyle = "rgba(61, 255, 138, 0.14)";
    ctx.fill();
  }
  global.drawChart = drawChart;
})(window);
