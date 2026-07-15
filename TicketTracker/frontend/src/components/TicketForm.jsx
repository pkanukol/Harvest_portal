import { useState } from "react";

const MAX_IMAGES = 3;

export default function TicketForm({ categories, onSubmit, submitting, submitError }) {
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [itemName, setItemName] = useState("");
  const [approxCost, setApproxCost] = useState("");
  const [quantity, setQuantity] = useState("");
  const [specifications, setSpecifications] = useState("");
  const [orderByDate, setOrderByDate] = useState("");
  const [imageLinks, setImageLinks] = useState([""]);

  const activeCategory = category || categories[0] || "";
  const isStores = activeCategory === "Stores";

  const updateLink = (idx, value) => {
    setImageLinks((prev) => prev.map((l, i) => (i === idx ? value : l)));
  };

  const addLinkField = () => {
    if (imageLinks.length < MAX_IMAGES) setImageLinks((prev) => [...prev, ""]);
  };

  const removeLinkField = (idx) => {
    setImageLinks((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    const links = imageLinks.map((l) => l.trim()).filter(Boolean);
    if (isStores) {
      onSubmit({
        category: activeCategory,
        itemName, approxCost: approxCost ? Number(approxCost) : null,
        quantity: quantity ? Number(quantity) : null,
        specifications, orderByDate,
        imageLinks: links,
      });
    } else {
      onSubmit({ category: activeCategory, description, imageLinks: links });
    }
  };

  return (
    <form className="card ticket-form" onSubmit={handleSubmit}>
      <h2 className="card-heading">Log a New Ticket</h2>

      <label className="field-label">Category</label>
      <select className="field-input" value={activeCategory} onChange={(e) => setCategory(e.target.value)}>
        {categories.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>

      {isStores ? (
        <>
          <label className="field-label">Item Name</label>
          <input
            type="text" className="field-input" placeholder="e.g. A4 printer paper"
            value={itemName} onChange={(e) => setItemName(e.target.value)}
          />

          <label className="field-label">Approx Cost (per item)</label>
          <input
            type="number" min="0" step="0.01" className="field-input" placeholder="₹"
            value={approxCost} onChange={(e) => setApproxCost(e.target.value)}
          />

          <label className="field-label">Number of Items Required</label>
          <input
            type="number" min="1" step="1" className="field-input"
            value={quantity} onChange={(e) => setQuantity(e.target.value)}
          />

          <label className="field-label">Specifications (optional)</label>
          <textarea
            className="field-input" rows={3} placeholder="Brand, size, model, or other details"
            value={specifications} onChange={(e) => setSpecifications(e.target.value)}
          />

          <label className="field-label">Order By Date</label>
          <input
            type="date" className="field-input"
            value={orderByDate} onChange={(e) => setOrderByDate(e.target.value)}
          />
        </>
      ) : (
        <>
          <label className="field-label">Describe the problem</label>
          <textarea
            className="field-input"
            rows={5}
            placeholder="What went wrong? Include as much detail as helps whoever picks this up."
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </>
      )}

      <label className="field-label">Photos (optional, up to {MAX_IMAGES})</label>
      <div className="help-text">
        Upload your photo to Google Drive, set sharing to "Anyone with the link", then paste the link here.
      </div>

      {imageLinks.map((link, idx) => (
        <div className="link-input-row" key={idx}>
          <input
            type="url"
            className="field-input"
            placeholder="https://drive.google.com/file/d/..."
            value={link}
            onChange={(e) => updateLink(idx, e.target.value)}
          />
          {imageLinks.length > 1 && (
            <button type="button" className="link-remove" onClick={() => removeLinkField(idx)}>×</button>
          )}
        </div>
      ))}

      {imageLinks.length < MAX_IMAGES && (
        <button type="button" className="btn btn-ghost btn-add-link" onClick={addLinkField}>
          + Add another link
        </button>
      )}

      {submitError && <div className="form-error">{submitError}</div>}

      <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
        {submitting ? "Submitting…" : "Submit Ticket"}
      </button>
    </form>
  );
}
