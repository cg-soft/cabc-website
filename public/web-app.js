(() => {
  // Online only: never persist tokens, member data or scheduling requests.
  const standalone = window.navigator.standalone === true ||
    window.matchMedia("(display-mode: standalone)").matches;
  document.documentElement.classList.toggle("standalone-app", standalone);
  if (standalone && ["", "#", "#home"].includes(window.location.hash)) {
    window.history.replaceState(null, "", "#calendar");
  }
  const updateConnection = () => {
    const offline = window.navigator.onLine === false;
    document.documentElement.classList.toggle("is-offline", offline);
    document.querySelector("#network-notice").hidden = !offline;
  };
  window.addEventListener("online", updateConnection);
  window.addEventListener("offline", updateConnection);
  updateConnection();
})();
