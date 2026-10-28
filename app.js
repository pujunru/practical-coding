import { currentRoute, showNotFound } from "./lib.js";
import { leaveCoding, showList, showProblem } from "./coding.js";
import { showQuestion, showQuestions } from "./sd.js";

const nav = document.getElementById("nav");

function route() {
  leaveCoding();
  window.onkeydown = null;
  const path = currentRoute();
  const section = path.startsWith("sd/") ? "questions" : "coding";
  for (const a of nav.querySelectorAll("a")) a.toggleAttribute("aria-current", a.dataset.section === section);
  let m;
  if ((m = path.match(/^p\/([^/]+)(?:\/(\d+))?$/))) showProblem(decodeURIComponent(m[1]), Number(m[2]) || 0);
  else if (path === "" || path === "/") showList();
  else if (path === "sd/questions") showQuestions();
  else if ((m = path.match(/^sd\/q\/([^/]+)$/))) showQuestion(decodeURIComponent(m[1]));
  else showNotFound();
}

window.addEventListener("hashchange", route);
// CodeMirror is a deferred classic script; module scripts run after it.
route();
