import { useState, useEffect } from 'react';
import { getItemId } from './mediaUtils.js';

let queueState = [];
const listeners = new Set();
const toastListeners = new Set();

function notify() {
  const snapshot = [...queueState];
  listeners.forEach((fn) => {
    try {
      fn(snapshot);
    } catch {
      // ignore
    }
  });
}

function notifyToast(eventData) {
  queueMicrotask(() => {
    toastListeners.forEach((fn) => {
      try {
        fn(eventData);
      } catch {
        // ignore
      }
    });
  });
}

export function subscribeQueueToast(fn) {
  toastListeners.add(fn);
  return () => toastListeners.delete(fn);
}

export function getQueue() {
  return queueState;
}

export function addToQueue(item) {
  if (!item) return;
  const targetId = getItemId(item);
  const exists = queueState.some((q) => {
    const qId = getItemId(q);
    if (targetId != null && qId != null) return qId === targetId;
    return q === item;
  });

  if (!exists) {
    queueState = [...queueState, item];
    const pos = queueState.length;
    notify();
    notifyToast({
      item,
      position: pos,
      action: 'add',
      message: `Added to queue (${pos})`,
      timestamp: Date.now(),
    });
  } else {
    const pos = getQueuePosition(item);
    notifyToast({
      item,
      position: pos,
      action: 'exists',
      message: `Already in queue (${pos})`,
      timestamp: Date.now(),
    });
  }
}

export function addToQueueStart(item) {
  if (!item) return;
  const targetId = getItemId(item);

  // Remove item if already present in queue
  const filtered = queueState.filter((q) => {
    const qId = getItemId(q);
    if (targetId != null && qId != null) return qId !== targetId;
    return q !== item;
  });

  // Prepend to top/start of queue
  queueState = [item, ...filtered];
  notify();
  notifyToast({
    item,
    position: 1,
    action: 'start',
    message: `Added to queue (1)`,
    timestamp: Date.now(),
  });
}

export function showToast(data) {
  if (!data) return;
  notifyToast({
    timestamp: Date.now(),
    ...data,
  });
}

export function removeFromQueue(item, silent = false) {
  if (!item) return;
  const targetId = getItemId(item);
  queueState = queueState.filter((q) => {
    const qId = getItemId(q);
    if (targetId != null && qId != null) return qId !== targetId;
    return q !== item;
  });
  notify();
  if (!silent) {
    notifyToast({
      item,
      action: 'remove',
      type: 'remove',
      message: `Removed from queue`,
      timestamp: Date.now(),
    });
  }
}

export function clearQueue(silent = false) {
  const prevCount = queueState.length;
  queueState = [];
  notify();
  if (!silent && prevCount > 0) {
    notifyToast({
      action: 'clear',
      type: 'clear',
      message: `Cleared queue (${prevCount})`,
      timestamp: Date.now(),
    });
  }
}

export function dequeueNext() {
  if (queueState.length === 0) return null;
  const nextItem = queueState[0];
  queueState = queueState.slice(1);
  notify();
  return nextItem;
}

export function isItemQueued(item) {
  if (!item) return false;
  const targetId = getItemId(item);
  return queueState.some((q) => {
    const qId = getItemId(q);
    if (targetId != null && qId != null) return qId === targetId;
    return q === item;
  });
}

export function getQueuePosition(item) {
  if (!item) return 0;
  const targetId = getItemId(item);
  const idx = queueState.findIndex((q) => {
    const qId = getItemId(q);
    if (targetId != null && qId != null) return qId === targetId;
    return q === item;
  });
  return idx >= 0 ? idx + 1 : 0;
}

export function applyQueueGrouping(items, queue, isSortReversed) {
  if (!queue || queue.length === 0 || !items || items.length === 0) {
    return items;
  }

  const queuedIdSet = new Set();
  queue.forEach((q) => {
    const qId = getItemId(q);
    if (qId != null) queuedIdSet.add(String(qId));
  });

  const isQueued = (item) => {
    const id = getItemId(item);
    if (id != null) return queuedIdSet.has(String(id));
    return queue.includes(item);
  };

  const nonQueuedItems = items.filter((item) => !isQueued(item));

  const queuedItems = [];
  queue.forEach((qItem) => {
    const qId = getItemId(qItem);
    const match = items.find((it) => {
      const itId = getItemId(it);
      if (qId != null && itId != null) return String(qId) === String(itId);
      return it === qItem;
    });
    if (match) {
      queuedItems.push(match);
    }
  });

  if (isSortReversed) {
    // Arrow UP (reverse order is true): Grouped queued items placed UP TOP!
    return [...queuedItems, ...nonQueuedItems];
  } else {
    // Arrow DOWN (reverse order is false): Grouped queued items placed DOWN BOTTOM!
    return [...nonQueuedItems, ...queuedItems];
  }
}

export function useQueue() {
  const [queue, setQueue] = useState(queueState);

  useEffect(() => {
    const handler = (newQueue) => setQueue(newQueue);
    listeners.add(handler);
    return () => listeners.delete(handler);
  }, []);

  return {
    queue,
    addToQueue,
    addToQueueStart,
    removeFromQueue,
    clearQueue,
    dequeueNext,
    isItemQueued,
    getQueuePosition,
    applyQueueGrouping: (items, isSortReversed) => applyQueueGrouping(items, queue, isSortReversed),
  };
}
