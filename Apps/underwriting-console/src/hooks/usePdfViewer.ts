import { useState, useCallback } from 'react';

export interface SpatialCoordinates {
  pageIndex: number;
  box: [number, number, number, number]; // [x, y, width, height] as relative percentage ratios (0 to 100)
}

export interface UsePdfViewerReturn {
  currentPage: number;
  zoomScale: number;
  activeHighlight: SpatialCoordinates | null;
  totalPages: number;
  nextPage: () => void;
  prevPage: () => void;
  setPage: (page: number) => void;
  /** Sync the pager with the actual page count of a loaded document. */
  setTotalPages: (pages: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetZoom: () => void;
  triggerHighlight: (coords: SpatialCoordinates) => void;
  clearHighlight: () => void;
}

/**
 * PRODUCTION-GRADE HOOK FOR COGNITIVE PDF DOCUMENT VISUALIZATION
 * =============================================================================
 * Manages the layout state of our dual-pane underwriter verification screens.
 * Tracks active bounding boxes, scale transformations, and page indices [cite: 177, 7ee83f58-0785-4f3c-9ff7-34b693f1a12d].
 */
export function usePdfViewer(initialTotalPages: number = 3): UsePdfViewerReturn {
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [zoomScale, setZoomScale] = useState<number>(1.0);
  const [activeHighlight, setActiveHighlight] = useState<SpatialCoordinates | null>(null);
  const [totalPages, setTotalPagesState] = useState<number>(initialTotalPages);

  const setTotalPages = useCallback((pages: number) => {
    const next = Math.max(1, Math.floor(pages));
    setTotalPagesState(next);
    setCurrentPage((prev) => Math.min(prev, next));
  }, []);

  const nextPage = useCallback(() => {
    setCurrentPage((prev) => Math.min(prev + 1, totalPages));
  }, [totalPages]);

  const prevPage = useCallback(() => {
    setCurrentPage((prev) => Math.max(prev - 1, 1));
  }, []);

  const setPage = useCallback((page: number) => {
    if (page >= 1 && page <= totalPages) {
      setCurrentPage(page);
    }
  }, [totalPages]);

  const zoomIn = useCallback(() => {
    setZoomScale((prev) => Math.min(prev + 0.25, 2.5));
  }, []);

  const zoomOut = useCallback(() => {
    setZoomScale((prev) => Math.max(prev - 0.25, 0.5));
  }, []);

  const resetZoom = useCallback(() => {
    setZoomScale(1.0);
  }, []);

  const triggerHighlight = useCallback((coords: SpatialCoordinates) => {
    setActiveHighlight(coords);
    // Auto-scroll the viewer to the target page index (pageIndex is 0-based, UI page is 1-based)
    setCurrentPage(coords.pageIndex + 1);
  }, []);

  const clearHighlight = useCallback(() => {
    setActiveHighlight(null);
  }, []);

  return {
    currentPage,
    zoomScale,
    activeHighlight,
    totalPages,
    nextPage,
    prevPage,
    setPage,
    setTotalPages,
    zoomIn,
    zoomOut,
    resetZoom,
    triggerHighlight,
    clearHighlight,
  };
}
