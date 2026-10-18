import { env, pipeline } from '@xenova/transformers';

const EMBEDDING_MODEL = 'Xenova/paraphrase-multilingual-MiniLM-L12-v2';

env.allowLocalModels = false;
env.useBrowserCache = true;

let extractorPromise;

function getExtractor() {
  if (!extractorPromise) {
    extractorPromise = pipeline('feature-extraction', EMBEDDING_MODEL, {
      quantized: true,
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
  return `${title} by ${artist}`.trim();
}

/**
 * Ranks song candidates by multilingual semantic similarity to a free-form query.
 *
 * The model is loaded only when manual search is used and is cached by
 * Transformers.js in the browser for subsequent searches.
 */
export async function rankCandidatesSemantically(query, candidates) {
  if (!query?.trim() || candidates.length < 2) return candidates;

  const extractor = await getExtractor();
  const queryOutput = await extractor(query.trim(), { pooling: 'mean', normalize: true });
  const queryVector = toVector(queryOutput);

  const scored = await Promise.all(candidates.map(async (candidate, index) => {
    const output = await extractor(candidateText(candidate), { pooling: 'mean', normalize: true });
    return {
      candidate,
      index,
      score: cosineSimilarity(queryVector, toVector(output)),
    };
  }));

  return scored
    .sort((left, right) => right.score - left.score || left.index - right.index)
    .map(({ candidate }) => candidate);
}
