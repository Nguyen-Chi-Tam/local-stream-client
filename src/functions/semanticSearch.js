import { env, pipeline } from '@xenova/transformers';
import { markSemanticSearchReady } from './semanticState.js';

const EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';
const EMBEDDING_BATCH_SIZE = 8;
const MAX_CACHED_EMBEDDINGS = 600;

env.allowLocalModels = false;
env.useBrowserCache = true;

let extractorPromise;
const embeddingCache = new Map();

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', EMBEDDING_MODEL, {
      quantized: true,
    }).then((extractor) => {
      markSemanticSearchReady();
      return extractor;
    }).catch((error) => {
      // Allow a later search to retry after a transient download/load failure.
      extractorPromise = null;
      throw error;
    });
  }
  return extractorPromise;
}

function toVector(output) {
  if (output?.data) return output.data;
  if (Array.isArray(output) && output[0]?.data) return output[0].data;
  throw new Error('Semantic search returned an invalid embedding.');
}

function cosineSimilarity(left, right) {
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;

  for (let i = 0; i < left.length; i += 1) {
    dot += left[i] * right[i];
    leftMagnitude += left[i] ** 2;
    rightMagnitude += right[i] ** 2;
  }

  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude);
  return denominator > 0 ? dot / denominator : 0;
}

function candidateText(candidate) {
  const title = candidate.name || candidate.trackName || '';
  const artist = candidate.artistName || '';
  if (!title) return artist ? `Unknown title by ${artist}` : '';
  return artist ? `${title} by ${artist}` : title;
}

function rememberEmbedding(text, vector) {
  if (embeddingCache.has(text)) {
    embeddingCache.delete(text);
  }
  embeddingCache.set(text, vector);
  if (embeddingCache.size > MAX_CACHED_EMBEDDINGS) {
    const oldestKey = embeddingCache.keys().next().value;
    embeddingCache.delete(oldestKey);
  }
}

async function embedTexts(extractor, texts) {
  const vectors = new Array(texts.length);
  const missing = [];

  texts.forEach((text, index) => {
    const cached = text ? embeddingCache.get(text) : null;
    if (cached) {
      // Refresh LRU position for repeated searches.
      rememberEmbedding(text, cached);
      vectors[index] = cached;
    } else if (text) {
      missing.push(index);
    }
  });

  for (let start = 0; start < missing.length; start += EMBEDDING_BATCH_SIZE) {
    const batchIndices = missing.slice(start, start + EMBEDDING_BATCH_SIZE);
    const batchTexts = batchIndices.map((index) => texts[index]);
    const output = await extractor(batchTexts, { pooling: 'mean', normalize: true });
    const data = toVector(output);
    const dimensions = Array.isArray(output?.dims) ? output.dims : [];
    const vectorSize = dimensions.length > 0
      ? dimensions[dimensions.length - 1]
      : data.length / batchTexts.length;

    batchIndices.forEach((textIndex, batchIndex) => {
      const vector = data.slice(batchIndex * vectorSize, (batchIndex + 1) * vectorSize);
      vectors[textIndex] = vector;
      rememberEmbedding(texts[textIndex], vector);
    });
  }

  return vectors;
}

/**
 * Starts loading the embedding model in the background. Opening the manual
 * search box calls this so the first search is less likely to wait for the
 * model download.
 */
export function warmUpSemanticSearch() {
  getExtractor().catch((error) => {
    console.warn('Semantic lyrics model unavailable:', error);
  });
}



/**
 * Scores candidates by multilingual semantic similarity to a free-form query.
 * The result array is aligned with `candidates`; each item is { index, score }.
 * Embeddings are cached per candidate text so repeated searches are cheap.
 */
export async function scoreCandidatesSemantically(query, candidates) {
  if (!query?.trim() || !Array.isArray(candidates) || candidates.length === 0) {
    return null;
  }

  const extractor = await getExtractor();
  const queryOutput = await extractor(query.trim(), { pooling: 'mean', normalize: true });
  const queryVector = toVector(queryOutput);
  const candidateTexts = candidates.map(candidateText);
  const candidateVectors = await embedTexts(extractor, candidateTexts);

  return candidateTexts.map((text, index) => ({
    index,
    score: text ? cosineSimilarity(queryVector, candidateVectors[index]) : 0,
  }));
}

/**
 * Ranks song candidates by multilingual semantic similarity to a free-form query.
 *
 * The model is loaded only when manual search is used and is cached by
 * Transformers.js in the browser for subsequent searches.
 */
export async function rankCandidatesSemantically(query, candidates) {
  if (!query?.trim() || candidates.length < 2) return candidates;

  try {
    const scored = await scoreCandidatesSemantically(query, candidates);
    if (!scored) return candidates;

    return scored
      .sort((left, right) => right.score - left.score || left.index - right.index)
      .map(({ index }) => candidates[index]);
  } catch (error) {
    console.warn('Semantic lyrics ranking unavailable:', error);
    return candidates;
  }
}
