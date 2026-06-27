import { Card } from "../ui/Card";
import { Button } from "../ui/Button";
import type { EmployeeDocumentItem } from "../../types/api";
import { formatLagosDateTime } from "../../utils/datetime";
import { cloudinaryDownloadUrl } from "../../utils/cloudinary";

function documentTitle(doc: EmployeeDocumentItem): string {
  return (doc.label ?? "").trim() || "Document";
}

function downloadFilename(doc: EmployeeDocumentItem): string {
  const label = documentTitle(doc).replace(/[^\w\s.-]/g, "").trim() || "document";
  const extMatch = doc.url.match(/\.([a-zA-Z0-9]+)(?:\?|$)/);
  const ext = extMatch?.[1]?.toLowerCase();
  if (ext && !label.toLowerCase().endsWith(`.${ext}`)) return `${label}.${ext}`;
  return label;
}

type Props = {
  documents?: EmployeeDocumentItem[] | null;
};

export function EmployeeEmploymentDocumentsSection({ documents }: Props) {
  const docs = documents ?? [];

  return (
    <Card className="!p-4">
      <div className="text-xs font-semibold text-black/55">Employment Documents</div>
      <p className="mt-1 text-xs text-black/55">
        Employment files uploaded by the employee (National ID, passport photo, guarantor form, employment letter, CV, etc.).
      </p>
      {docs.length === 0 ? (
        <div className="mt-3 text-sm text-black/60">No employment documents uploaded.</div>
      ) : (
        <ul className="mt-3 space-y-2">
          {docs.map((doc) => (
            <li
              key={doc.id}
              className="flex flex-col gap-3 rounded-xl border border-black/10 bg-black/[0.02] px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-bold">{documentTitle(doc)}</div>
                {doc.uploaded_at ? (
                  <div className="mt-0.5 text-xs font-semibold text-black/55">Uploaded {formatLagosDateTime(doc.uploaded_at)}</div>
                ) : null}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  className="!min-h-9 !px-3 !py-1.5 !text-xs"
                  onClick={() => {
                    window.location.href = doc.url;
                  }}
                >
                  View
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="!min-h-9 !px-3 !py-1.5 !text-xs"
                  onClick={() => {
                    window.open(doc.url, "_blank", "noopener,noreferrer");
                  }}
                >
                  Open in new tab
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="!min-h-9 !px-3 !py-1.5 !text-xs"
                  onClick={() => {
                    const a = document.createElement("a");
                    a.href = cloudinaryDownloadUrl(doc.url);
                    a.download = downloadFilename(doc);
                    a.target = "_blank";
                    a.rel = "noopener noreferrer";
                    document.body.appendChild(a);
                    a.click();
                    a.remove();
                  }}
                >
                  Download
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
