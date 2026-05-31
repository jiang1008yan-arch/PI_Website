import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, Package, Plus } from "lucide-react";
import { api } from "../api/client";
import { EmptyState, ErrorText, Field, PageHero, Section } from "../components/Form";
import type { Language, Product, ProductField } from "../types";
import { blankRule, ModelRule, modelRuleKey, optionPath } from "../pi/modelRule";
import { FieldRow } from "../products/FieldRow";
import { FilePicker } from "../products/FilePicker";
import { ModelRuleEditor } from "../products/ModelRuleEditor";
import {
  blankField,
  blankProduct,
  normalizeField,
  parseField,
  productPayload,
  resequence
} from "../products/productFields";
import { loadProductModelRule } from "../products/modelRuleAdmin";

export function ProductsPage() {
  const [products, setProducts] = useState<Product[]>([]);
  const [product, setProduct] = useState<any>(blankProduct);
  const [selected, setSelected] = useState<Product | null>(null);
  const [fieldsByLang, setFieldsByLang] = useState<Record<Language, ProductField[]>>({ EN: [], ZH: [] });
  const [rulesByLang, setRulesByLang] = useState<Record<Language, ModelRule>>({ EN: blankRule(), ZH: blankRule() });
  const [lang, setLang] = useState<Language>("EN");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  const enFieldOptions = fieldsByLang.EN
    .filter((f) => f.id && !f.id.startsWith("draft-") && f.label.trim())
    .map((f) => ({ id: f.id as string, label: f.label }));

  const loadProducts = async () => {
    const res = await api.get("/products");
    setProducts(res.data);
  };

  useEffect(() => { loadProducts(); }, []);

  async function openProduct(p: Product) {
    setError("");
    setNotice("");
    setSelected(p);
    setProduct(p);
    setEditing(true);
    const [en, zh, enRule, zhRule] = await Promise.all([
      api.get(`/products/${p.id}/fields?language=EN`),
      api.get(`/products/${p.id}/fields?language=ZH`),
      loadProductModelRule(p.id, "EN"),
      loadProductModelRule(p.id, "ZH")
    ]);
    setFieldsByLang({ EN: en.data.map(parseField), ZH: zh.data.map(parseField) });
    setRulesByLang({ EN: enRule, ZH: zhRule });
  }

  function resetForm() {
    setSelected(null);
    setProduct(blankProduct);
    setFieldsByLang({ EN: [], ZH: [] });
    setRulesByLang({ EN: blankRule(), ZH: blankRule() });
    setLang("EN");
    setError("");
    setNotice("");
    setEditing(false);
  }

  function startNewProduct() {
    setSelected(null);
    setProduct(blankProduct);
    setFieldsByLang({ EN: [], ZH: [] });
    setRulesByLang({ EN: blankRule(), ZH: blankRule() });
    setLang("EN");
    setError("");
    setNotice("");
    setEditing(true);
  }

  async function saveProduct(e: FormEvent) {
    e.preventDefault();
    setError("");
    setNotice("");
    setSaving(true);
    try {
      if (selected) {
        await api.patch(`/products/${selected.id}`, productPayload(product, selected));
        await saveModelRules(selected.id);
        setNotice("Product saved.");
      } else {
        const res = await api.post("/products", productPayload(product));
        const productId = res.data.id;
        await Promise.all(
          (["EN", "ZH"] as const).map((language) => {
            const fields = fieldsByLang[language]
              .filter((field) => field.label.trim())
              .map((field) => normalizeField(field, language));
            if (!fields.length) return Promise.resolve();
            return api.post(`/products/${productId}/fields-bulk`, { fields });
          })
        );
        await saveModelRules(productId);
        setNotice("Product created.");
        resetForm();
      }
      await loadProducts();
    } catch (err: any) {
      setError(err.response?.data?.error ?? "Product could not be saved. Check the required fields.");
    } finally {
      setSaving(false);
    }
  }

  async function saveField(field: ProductField) {
    const normalized = normalizeField(field, lang);
    if (!normalized.label) {
      setError("Field label is required.");
      return;
    }
    setError("");

    if (!selected) {
      const localField = { ...normalized, id: field.id ?? `draft-${crypto.randomUUID()}` };
      setFieldsByLang((state) => ({
        ...state,
        [lang]: resequence(
          field.id ? state[lang].map((item) => (item.id === field.id ? localField : item)) : [...state[lang], localField]
        )
      }));
      return;
    }

    if (field.id) {
      await api.patch(`/products/${selected.id}/fields/${field.id}`, normalized);
    } else {
      const existing = fieldsByLang[lang];
      const nextSortOrder = existing.length
        ? Math.max(...existing.map((f) => Number(f.sortOrder ?? 0))) + 1
        : 0;
      await api.post(`/products/${selected.id}/fields`, { ...normalized, sortOrder: nextSortOrder });
    }
    const res = await api.get(`/products/${selected.id}/fields?language=${lang}`);
    setFieldsByLang((state) => ({ ...state, [lang]: res.data.map(parseField) }));
  }

  async function moveField(index: number, direction: -1 | 1) {
    const nextIndex = index + direction;
    const currentFields = fieldsByLang[lang];
    if (nextIndex < 0 || nextIndex >= currentFields.length) return;
    const reordered = [...currentFields];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(nextIndex, 0, moved);
    const sequenced = resequence(reordered);
    setFieldsByLang((state) => ({ ...state, [lang]: sequenced }));

    if (selected) {
      await Promise.all(
        sequenced
          .filter((field) => field.id && !field.id.startsWith("draft-"))
          .map((field) => api.patch(`/products/${selected.id}/fields/${field.id}`, normalizeField(field, lang)))
      );
    }
  }

  async function deleteField(field: ProductField) {
    if (!field.id) return;
    const fieldLabel = field.label?.trim() || "this field";
    if (!window.confirm(`Delete "${fieldLabel}"? This cannot be undone.`)) return;
    if (selected && !field.id.startsWith("draft-")) await api.delete(`/products/${selected.id}/fields/${field.id}`);
    setFieldsByLang((state) => ({
      ...state,
      [lang]: resequence(state[lang].filter((item) => item.id !== field.id))
    }));
  }

  async function uploadTemplate(language: Language, file?: File) {
    if (!selected || !file) return;
    const res = await api.post(`/products/${selected.id}/template/${language.toLowerCase()}/upload-url`);
    await api.put(res.data.uploadUrl.replace("/api", ""), file, {
      headers: { "content-type": file.type || "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }
    });
    await api.post(`/products/${selected.id}/template/${language.toLowerCase()}/commit`, { key: res.data.key });
    setNotice(`${language === "EN" ? "English" : "Chinese"} sub-template uploaded.`);
  }

  async function saveModelRules(productId: string) {
    for (const language of ["EN", "ZH"] as const) {
      await api.put(optionPath(modelRuleKey(productId, language)), { values: [JSON.stringify(rulesByLang[language])] });
    }
  }

  if (!editing) {
    return (
      <div className="space-y-6">
        <PageHero
          eyebrow="Admin setup"
          title="Product Management"
          description="Shape each product once, then let PI creators fill consistent fields with fewer decisions and fewer mistakes."
          Icon={Package}
          action={<button className="btn-primary flex items-center gap-2" onClick={startNewProduct}><Plus size={16} />Add Product</button>}
        />
        <Section title="Products">
          {products.length === 0 ? (
            <EmptyState title="No products yet" description="Add your first product to unlock reusable PI fields and Excel sub-templates." />
          ) : (
          <table className="w-full text-sm">
            <tbody>
              {products.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="py-3 font-medium">{p.nameEn}</td>
                  <td>{p.nameZh}</td>
                  <td>{p.status}</td>
                  <td className="text-right">
                    <button className="btn-secondary" onClick={() => openProduct(p)}>Edit</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          )}
        </Section>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHero
        eyebrow="Product details"
        title={selected ? `Edit ${selected.nameEn || selected.nameZh}` : "Add Product"}
        description="Keep names, status, language fields and templates together so future invoices are faster to complete."
        Icon={Package}
      />
      <Section
        title={selected ? `Edit ${selected.nameEn || selected.nameZh}` : "Add Product"}
        action={
          <button className="btn-secondary flex items-center gap-2" onClick={resetForm}>
            <ArrowLeft size={16} />
            Back
          </button>
        }
      >
        <form onSubmit={saveProduct} className="space-y-5">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
            <Field label="English Name">
              <input value={product.nameEn} onChange={(e) => setProduct({ ...product, nameEn: e.target.value })} required />
            </Field>
            <Field label="Chinese Name">
              <input value={product.nameZh} onChange={(e) => setProduct({ ...product, nameZh: e.target.value })} required />
            </Field>
            <Field label="Status">
              <select value={product.status} onChange={(e) => setProduct({ ...product, status: e.target.value })}>
                <option>ACTIVE</option>
                <option>DISCONTINUED</option>
              </select>
            </Field>
            <button className="btn-primary mt-6" disabled={saving}>{saving ? "Saving..." : "Save Product"}</button>
          </div>
          <ErrorText message={error} />
          {notice && <div className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700">{notice}</div>}
        </form>

        <div className="border-t pt-5">
          <div className="mb-4 flex gap-2">
            <button className={lang === "EN" ? "btn-primary" : "btn-secondary"} onClick={() => setLang("EN")}>English Fields</button>
            <button className={lang === "ZH" ? "btn-primary" : "btn-secondary"} onClick={() => setLang("ZH")}>Chinese Fields</button>
          </div>
          {lang === "ZH" && (
            <p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700">
              Map each Chinese field to its English counterpart so EN→ZH PI generation can pre-fill values.
              Keep dropdown options in the same order across languages (Red/Green/Blue ↔ 红/绿/蓝) — values are
              carried over by option position.
            </p>
          )}
          <div className="space-y-3">
            {fieldsByLang[lang].map((field, index) => (
              <FieldRow
                key={field.id}
                field={field}
                onSave={saveField}
                onDelete={() => deleteField(field)}
                onMoveUp={() => moveField(index, -1)}
                onMoveDown={() => moveField(index, 1)}
                canMoveUp={index > 0}
                canMoveDown={index < fieldsByLang[lang].length - 1}
                enFields={lang === "ZH" ? enFieldOptions : undefined}
              />
            ))}
            <FieldRow
              key={`new-${lang}-${fieldsByLang[lang].length}`}
              field={blankField(lang)}
              onSave={saveField}
              enFields={lang === "ZH" ? enFieldOptions : undefined}
            />
          </div>
        </div>

        {lang === "ZH" && (
          <ModelRuleEditor
            disabled={false}
            language={lang}
            rule={rulesByLang[lang]}
            onChange={(rule) => setRulesByLang((state) => ({ ...state, [lang]: rule }))}
          />
        )}

        <div className="grid grid-cols-1 gap-3 border-t pt-5 md:grid-cols-2">
          <FilePicker label="English sub-template" disabled={!selected} onPick={(file) => uploadTemplate("EN", file)} />
          <FilePicker label="Chinese sub-template" disabled={!selected} onPick={(file) => uploadTemplate("ZH", file)} />
        </div>
        {!selected && <p className="text-sm text-slate-500">Save the product before uploading Excel sub-templates.</p>}
      </Section>
    </div>
  );
}
