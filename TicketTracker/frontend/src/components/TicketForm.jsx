import { useState } from "react";
import { compressImage } from "../imageCompress";

const MAX_IMAGES = 3;
const ALLOWED_TYPES = ["image/jpeg", "image/png"];

export default function TicketForm({ categories, onSubmit, submitting, submitError }) {
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [itemName, setItemName] = useState("");
  const [approxCost, setApproxCost] = useState("");
  const [quantity, setQuantity] = useState("");
  const [specifications, setSpecifications] = useState("");
  const [orderByDate, setOrderByDate] = useState("");
  const [images, setImages] = useState([]);
  const [previews, setPreviews] = useState([]);
  const [imageError, setImageError] = useState("");
  const [compressing, setCompressing] = useState(false);

  const activeCategory = category || categories[0] || "";
  const isStores = activeCategory === "Stores";

  const handleFiles = async (e) => {
    const files = Array.from(e.target.files || []);
    e.target.value = "";
    setImageError("");

    const room = MAX_IMAGES - images.length;
    if (room <= 0) return;

    const rejected = files.some((f) => !ALLOWED_TYPES.includes(f.type));
    if (rejected) {
      setImageError("Only JPG or PNG images are accepted.");
    }
    const accepted = files.filter((f) => ALLOWED_TYPES.includes(f.type)).slice(0, room);
    if (accepted.length === 0) return;

    setCompressing(true);
    try {
      const compressed = await Promise.all(accepted.map(compressImage));
      setImages((prev) => [...prev, ...compressed]);
      setPreviews((prev) => [...prev, ...compressed.map((f) => URL.createObjectURL(f))]);
    } finally {
      setCompressing(false);
    }
  };

  const removeImage = (idx) => {
    setImages((prev) => prev.filter((_, i) => i !== idx));
    setPreviews((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleSubmit = (e) => {
    e.preventDefault();
    if (isStores) {
      onSubmit({
        category: activeCategory,
        itemName, approxCost: approxCost ? Number(approxCost) : null,
        quantity: quantity ? Number(quantity) : null,
        specifications, orderByDate,
        images,
      });
    } else {
      onSubmit({ category: activeCategory, description, images });
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
      <input
        type="file"
        accept="image/jpeg,image/png"
        multiple
        disabled={images.length >= MAX_IMAGES || compressing}
        onChange={handleFiles}
      />
      {compressing && <div className="help-text">Compressing…</div>}
      {imageError && <div className="form-error">{imageError}</div>}

      {previews.length > 0 && (
        <div className="image-preview-row">
          {previews.map((src, idx) => (
            <div className="image-preview" key={src}>
              <img src={src} alt={`upload ${idx + 1}`} />
              <button type="button" className="image-remove" onClick={() => removeImage(idx)}>×</button>
            </div>
          ))}
        </div>
      )}

      {submitError && <div className="form-error">{submitError}</div>}

      <button className="btn btn-primary btn-block" type="submit" disabled={submitting}>
        {submitting ? "Submitting…" : "Submit Ticket"}
      </button>
    </form>
  );
}
