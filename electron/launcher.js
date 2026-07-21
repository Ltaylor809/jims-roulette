const status = document.getElementById("status");
const detail = document.getElementById("detail");
const progress = document.getElementById("progress");
const play = document.getElementById("play");
const check = document.getElementById("check");
const install = document.getElementById("install");

function render(payload) {
  status.textContent = payload.status;
  detail.textContent = payload.detail;
  progress.style.width = payload.progress == null ? "0%" : `${Math.max(0, Math.min(100, payload.progress))}%`;
  install.style.display = payload.status === "UPDATE READY" ? "block" : "none";
}

window.jimsLauncher.onStatus(render);
window.jimsLauncher.getInfo().then((info) => {
  document.getElementById("version").textContent = `BUILD ${info.version}${info.packaged ? "" : " / DEV"}`;
  render(info.updateReady
    ? { status: "UPDATE READY", detail: "RESTART TO INSTALL THE DOWNLOADED BUILD", progress: 100 }
    : { status: "READY", detail: "THE TABLE IS WAITING", progress: null });
});

play.addEventListener("click", async () => {
  play.disabled = true;
  render({ status: "OPENING TABLE", detail: "STARTING THE LOCAL GAME PROCESS", progress: 35 });
  try { await window.jimsLauncher.play(); }
  catch (error) { render({ status: "LAUNCH FAILED", detail: error.message || String(error), progress: null }); }
  finally { play.disabled = false; }
});
check.addEventListener("click", () => window.jimsLauncher.check());
install.addEventListener("click", () => window.jimsLauncher.install());
document.getElementById("quit").addEventListener("click", () => window.jimsLauncher.quit());
