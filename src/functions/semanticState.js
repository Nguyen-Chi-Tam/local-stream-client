// Tiny dependency-free flag shared by the lyrics service and the lazy semantic
// module. Keeping it separate prevents automatic lookup from importing the
// heavy Transformers.js chunk just to ask whether the model is loaded.
let semanticSearchReady = false;

export function markSemanticSearchReady() {
  semanticSearchReady = true;
}

export function isSemanticSearchReady() {
  return semanticSearchReady;
}
