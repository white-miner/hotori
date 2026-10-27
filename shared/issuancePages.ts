/** 발급 모달 슬라이드 — 뷰포트에 맞게 줄 단위로 나눔 */

export const ISS_LINES_PER_PAGE = 5;

export function chunkIssuanceLines<T>(items: T[], size = ISS_LINES_PER_PAGE): T[][] {
  const n = Math.max(1, Math.round(size) || ISS_LINES_PER_PAGE);
  if (!items.length) return [[]];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += n) out.push(items.slice(i, i + n));
  return out;
}

/**
 * 작성(0) + 미리보기 페이지들.
 * compose=true 이면 첫 슬라이드가 작성 폼.
 */
export function issuanceSlideCount(opts: {
  compose: boolean;
  lineCount: number;
  linesPerPage?: number;
  /** 합계·서명 등 꼬리 전용 페이지 (미리보기 마지막에 항상 1) */
  tailPage?: boolean;
}): number {
  const per = opts.linesPerPage ?? ISS_LINES_PER_PAGE;
  const body = Math.max(1, Math.ceil(Math.max(0, opts.lineCount) / per) || 1);
  const tail = opts.tailPage === false ? 0 : 1;
  // body pages already include lines; if only one body page and short, still +tail for totals
  // Simpler model: compose? + previewChunks (each chunk of lines) — last preview also shows totals.
  // So: compose + max(1, chunks) — totals live on last preview page (no extra).
  void tail;
  return (opts.compose ? 1 : 0) + Math.max(1, body);
}

export function issuancePreviewChunkIndex(page: number, compose: boolean): number | null {
  if (compose) {
    if (page <= 0) return null; // compose slide
    return page - 1;
  }
  return page;
}
