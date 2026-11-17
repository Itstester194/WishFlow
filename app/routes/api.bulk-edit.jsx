// Resource route used by the Bulk Product Editor page.
// The page calls it with fetch(); App Bridge adds the session token automatically.
import { authenticate } from "../shopify.server";
import {
  BATCH_SIZE,
  applyBulkOperation,
  collectProductIds,
  saveInlineChanges,
  validateOperation,
} from "../bulk-edit.server";

export const loader = () => Response.json({ error: "Method not allowed" }, { status: 405 });

export const action = async ({ request }) => {
  const { admin } = await authenticate.admin(request);

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Invalid request body." }, { status: 400 });
  }

  try {
    switch (body.intent) {
      case "collectIds": {
        const ids = await collectProductIds(admin, body.query || "");
        return Response.json({ ids });
      }

      case "bulkApply": {
        const ids = Array.isArray(body.ids) ? body.ids.slice(0, BATCH_SIZE) : [];
        const problem = validateOperation(body.operation);
        if (problem) return Response.json({ error: problem }, { status: 400 });
        const results = await applyBulkOperation(admin, ids, body.operation);
        return Response.json({ results });
      }

      case "saveInline": {
        const changes = Array.isArray(body.changes) ? body.changes.slice(0, BATCH_SIZE) : [];
        const results = await saveInlineChanges(admin, changes);
        return Response.json({ results });
      }

      default:
        return Response.json({ error: "Unknown intent." }, { status: 400 });
    }
  } catch (error) {
    return Response.json({ error: error?.message || "Something went wrong." }, { status: 500 });
  }
};
