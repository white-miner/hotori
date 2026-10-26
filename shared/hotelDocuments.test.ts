import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  HOTEL_DOC_KIND_LABEL,
  HOTEL_DOC_KINDS,
  hotelDocExpiryBadge,
  hotelDocHubCopy,
  hotelDocStoragePath,
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
    assert.equal(isHotelDocKind("other"), true);
    assert.equal(isHotelDocKind("nope"), false);
    assert.equal(isHotelDocHubKind("bank_book"), true);
    assert.equal(isHotelDocHubKind("other"), false);
    assert.deepEqual([...HOTEL_DOC_KINDS], ["fire_insurance", "bank_book", "business_license", "other"]);
    assert.equal(HOTEL_DOC_KIND_LABEL.bank_book, "통장사본");
    assert.equal(HOTEL_DOC_KIND_LABEL.business_license, "사업자등록증");
    assert.equal(hotelDocHubCopy("bank_book").title, "통장사본");
    assert.equal(
      hotelDocStoragePath("hid", "did", "화재 보험.pdf"),
      "hid/certs/did/화재 보험.pdf",
    );
    assert.equal(sanitizeDocFilename("a/b\\c?.pdf"), "a_b_c_.pdf");
  });

  it("mime + validate file/draft", () => {
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
  });

  it("expiry badge", () => {
    assert.equal(hotelDocExpiryBadge(null, "2026-10-26"), null);
    assert.equal(hotelDocExpiryBadge("2026-09-01", "2026-10-26"), "expired");
    assert.equal(hotelDocExpiryBadge("2026-11-01", "2026-10-26"), "soon");
    assert.equal(hotelDocExpiryBadge("2027-01-01", "2026-10-26"), null);
  });
});
