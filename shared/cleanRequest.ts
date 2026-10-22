// 「현황」운영: 청소 요청 팝업 → noClean patch (즉시 토글 금지)

export const CLEAN_REQUEST_TITLE = "청소 요청";
export const CLEAN_REQUEST_COPY = "청소 요청";

export type CleanRequestChoice = "clean" | "no_clean";

export const CLEAN_REQUEST_OPTIONS: { id: CleanRequestChoice; label: string; noClean: boolean }[] = [
  { id: "clean", label: "청소 함", noClean: false },
  { id: "no_clean", label: "청소 안 함", noClean: true },
];

/** 확정 시에만 patch. 현재값과 같으면 no-op 가능(호출측에서 skip). */
export function cleanRequestNoClean(choice: CleanRequestChoice): boolean {
  return choice === "no_clean";
}
