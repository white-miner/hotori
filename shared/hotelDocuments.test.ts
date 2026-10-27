import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HOTEL_DOC_KIND_LABEL,
  HOTEL_DOC_KINDS,
  ISSUANCE_COPY,
  hotelDocExpiryBadge,
  hotelDocFailMessage,
  hotelDocHubCopy,
  hotelDocPageTitle,
  hotelDocStoragePath,
  hotelDocUploadOkMessage,
  isHotelDocHubKind,
  isHotelDocKind,
  mimeFromFile,
  sanitizeDocFilename,
  validateHotelDocFile,
  validateHotelDocumentDraft,
} from "./hotelDocuments.ts";

describe("hotelDocuments", () => {
  it("kind + path + sanitize", () => {
    assert.equal(isHotelDocKind("fire_insurance"), true);
    assert.equal(isHotelDocKind("bank_book"), true);
    assert.equal(isHotelDocKind("business_license"), true);
    assert.equal(isHotelDocKind("operating_report"), true);
    assert.equal(isHotelDocKind("other"), true);
    assert.equal(isHotelDocKind("nope"), false);
    assert.equal(isHotelDocHubKind("bank_book"), true);
    assert.equal(isHotelDocHubKind("operating_report"), true);
    assert.equal(isHotelDocHubKind("other"), false);
    assert.deepEqual(
      [...HOTEL_DOC_KINDS],
      ["fire_insurance", "bank_book", "business_license", "operating_report", "other"],
    );
    assert.equal(HOTEL_DOC_KIND_LABEL.bank_book, "통장사본");
    assert.equal(HOTEL_DOC_KIND_LABEL.business_license, "사업자등록증");
    assert.equal(HOTEL_DOC_KIND_LABEL.operating_report, "영업신고증");
    assert.equal(ISSUANCE_COPY.operatingReport, "영업신고증");
    assert.equal(hotelDocHubCopy("bank_book").title, "통장사본");
    assert.equal(hotelDocHubCopy("operating_report").title, "영업신고증");
    assert.equal(hotelDocHubCopy("fire_insurance").hint, "여러 장 업로드 · 열기 · 인쇄");
    assert.equal(hotelDocPageTitle("화재보험증서", 0, 1), "화재보험증서");
    assert.equal(hotelDocPageTitle("화재보험증서", 0, 3), "화재보험증서 (1/3)");
    assert.equal(hotelDocPageTitle("화재보험증서", 2, 3), "화재보험증서 (3/3)");
    assert.equal(hotelDocUploadOkMessage(1), ISSUANCE_COPY.uploadOk);
    assert.equal(hotelDocUploadOkMessage(3), "증서 3장을 올렸어요.");
    assert.ok(!ISSUANCE_COPY.emptyVault.includes("영업신고서"));
    assert.ok(ISSUANCE_COPY.emptyVault.includes("영업신고증"));
    assert.ok(ISSUANCE_COPY.settingsVaultHint.includes("영업신고증"));
    // Hangul filenames → ASCII path (Supabase Storage InvalidKey otherwise)
    assert.equal(sanitizeDocFilename("사업자등록증.jpg"), "document.jpg");
    assert.equal(sanitizeDocFilename("사업자등록증 .jpg"), "document.jpg");
    assert.equal(sanitizeDocFilename("화재 보험.pdf"), "document.pdf");
    assert.equal(sanitizeDocFilename("license_2024.JPG"), "license_2024.jpg");
    assert.equal(sanitizeDocFilename("a/b\\c?.pdf"), "a_b_c.pdf");
    assert.equal(
      hotelDocStoragePath("hid", "did", "사업자등록증.jpg"),
      "hid/certs/did/document.jpg",
    );
  });

  it("hotelDocFailMessage maps Storage InvalidKey without raw English/status", () => {
    const msg = hotelDocFailMessage({
      message: "Invalid key: …/certs/…/사업자등록증.jpg",
      statusCode: "400",
      error: "InvalidKey",
    });
    assert.equal(msg, ISSUANCE_COPY.uploadFail);
    assert.equal(msg.includes("Invalid"), false);
    assert.equal(msg.includes("400"), false);
    assert.equal(hotelDocFailMessage({ message: "The resource already exists" }), ISSUANCE_COPY.uploadFailDup);
    assert.equal(hotelDocFailMessage({ message: "new row violates row-level security policy" }), ISSUANCE_COPY.uploadFailAuth);
    assert.equal(hotelDocFailMessage({ message: "Payload too large", statusCode: "413" }), ISSUANCE_COPY.fileTooBig);
  });

  it("mime + validate file/draft (expiry not required)", () => {
    const pdf = { name: "a.pdf", type: "application/pdf", size: 100 } as File;
    const bad = { name: "a.exe", type: "application/octet-stream", size: 100 } as File;
    const huge = { name: "a.pdf", type: "application/pdf", size: 21 * 1024 * 1024 } as File;
    assert.equal(mimeFromFile(pdf), "application/pdf");
    assert.equal(mimeFromFile(bad), null);
    assert.equal(validateHotelDocFile(pdf), null);
    assert.ok(validateHotelDocFile(bad));
    assert.ok(validateHotelDocFile(huge));
    assert.ok(validateHotelDocumentDraft({ kind: "fire_insurance", title: "  " }));
    assert.equal(validateHotelDocumentDraft({ kind: "fire_insurance", title: "화재보험 2026" }), null);
    assert.equal(validateHotelDocumentDraft({ kind: "bank_book", title: "국민은행 통장" }), null);
    assert.equal(validateHotelDocumentDraft({ kind: "business_license", title: "사업자등록증" }), null);
    assert.equal(
      validateHotelDocumentDraft({ kind: "operating_report", title: "영업신고증", expiresOn: null }),
      null,
    );
  });

  it("expiry badge", () => {
    assert.equal(hotelDocExpiryBadge(null, "2026-10-26"), null);
    assert.equal(hotelDocExpiryBadge("2026-09-01", "2026-10-26"), "expired");
    assert.equal(hotelDocExpiryBadge("2026-11-01", "2026-10-26"), "soon");
    assert.equal(hotelDocExpiryBadge("2027-01-01", "2026-10-26"), null);
  });
});
