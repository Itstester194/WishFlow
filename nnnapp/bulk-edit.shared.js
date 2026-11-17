// Constants shared by the server and the browser for the Bulk Product Editor.

export const PAGE_SIZES = [10, 25, 50];
export const BATCH_SIZE = 10; // products processed per API request

export const SORT_OPTIONS = {
  title_asc: { sortKey: "TITLE", reverse: false, label: "Title A–Z" },
  title_desc: { sortKey: "TITLE", reverse: true, label: "Title Z–A" },
  updated_desc: { sortKey: "UPDATED_AT", reverse: true, label: "Recently updated" },
  created_desc: { sortKey: "CREATED_AT", reverse: true, label: "Newest" },
  created_asc: { sortKey: "CREATED_AT", reverse: false, label: "Oldest" },
  vendor_asc: { sortKey: "VENDOR", reverse: false, label: "Vendor A–Z" },
  type_asc: { sortKey: "PRODUCT_TYPE", reverse: false, label: "Product type A–Z" },
};
