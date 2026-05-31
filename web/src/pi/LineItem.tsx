import { Field } from "../components/Form";
import type { Language, PiItem, Product } from "../types";
import { getMeta, setMeta, visibleItemFields } from "./lineItemFields";
import {
  applyModelRule,
  buildGeneratedModel,
  getModelRule,
  isGeneratedModelField,
  isModelField,
  isOrderMeaningField
} from "./modelRule";
import { currencies, formatCurrency, numericInputValue, parseNumericInput } from "./format";
import { productName } from "./labels";
import { ModelBuilder } from "./ModelBuilder";

export function LineItem({
  item,
  product,
  language,
  locked,
  tone = 0,
  onChange,
  onRemove
}: {
  item: PiItem;
  product?: Product;
  language: Language;
  locked: boolean;
  tone?: number;
  onChange: (it: PiItem) => void;
  onRemove: () => void;
}) {
  const currency = getMeta(item, "currency") || "USD";
  const amount = item.quantity * item.unitPrice * (1 - item.discountPct / 100);
  const rule = language === "ZH" ? getModelRule(item) : null;
  const generated = rule ? buildGeneratedModel(rule, item) : null;
  const fields = visibleItemFields(item).filter((field) => !rule || !isGeneratedModelField(field));
  const modelFields = language === "ZH" && !rule ? fields.filter(isModelField) : [];
  const orderMeaningFields = language === "ZH" && !rule ? fields.filter(isOrderMeaningField) : [];
  const remainingFields =
    language === "ZH" && !rule
      ? fields.filter((field) => !isModelField(field) && !isOrderMeaningField(field))
      : fields;
  const style = productTone(tone);

  return (
    <div className={`relative rounded-lg border p-3 shadow-[0_10px_24px_rgba(8,36,107,0.045)] ${style.card}`}>
      <div className={`absolute left-0 top-0 h-full w-1 rounded-l-lg ${style.rail}`} />
      {!locked && (
        <button
          type="button"
            className="btn-danger absolute right-3 top-3 px-4 py-1.5 text-xs"
          onClick={onRemove}
        >
          Remove
        </button>
      )}
      <div className="mb-3 pr-20">
        <Field label="Product Name">
          <div className={`rounded-lg px-3 py-2 text-sm font-medium ${style.name}`}>
            {productName(product, language)}
          </div>
        </Field>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Field label="Quantity">
          <input
            disabled={locked}
            type="number"
            value={numericInputValue(item.quantity)}
            onChange={(e) => onChange({ ...item, quantity: parseNumericInput(e.target.value) })}
          />
        </Field>
        {language === "EN" && (
          <>
            <Field label="Currency">
              <select
                disabled={locked}
                value={currency}
                onChange={(e) => onChange(setMeta(item, "currency", e.target.value))}
              >
                {currencies.map((option) => (
                  <option key={option.code} value={option.code}>
                    {option.symbol}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Unit Price">
              <input
                disabled={locked}
                type="number"
                step="0.01"
                value={numericInputValue(item.unitPrice)}
                onChange={(e) => onChange({ ...item, unitPrice: parseNumericInput(e.target.value) })}
              />
            </Field>
            <Field label="Discount %">
              <input
                disabled={locked}
                type="number"
                step="0.01"
                value={numericInputValue(item.discountPct)}
                onChange={(e) => onChange({ ...item, discountPct: parseNumericInput(e.target.value) })}
              />
            </Field>
            <Field label="Amount">
              <div className="rounded-lg bg-white px-3 py-2 text-sm">{formatCurrency(amount, currency)}</div>
            </Field>
          </>
        )}
      </div>
      {rule && generated && (
        <div className={style.model}>
          <ModelBuilder
            rule={rule}
            item={item}
            locked={locked}
            generated={generated}
            onChange={(next) => onChange(applyModelRule(next, language))}
          />
        </div>
      )}
      {language === "ZH" ? (
        <div className="mt-3 space-y-3">
          {modelFields.map((fv, idx) => (
            <FieldValueInput
              key={`${fv.label}-${idx}`}
              item={item}
              field={fv}
              locked={locked}
              onChange={onChange}
              wide
            />
          ))}
          {orderMeaningFields.length > 0 && (
            <div className="rounded-lg border border-[#e3ebf8] bg-[#f8fbff] p-3">
              <div className="mb-2 text-sm font-semibold">Order Code Meaning</div>
              <div className="space-y-2">
                {orderMeaningFields.map((fv, idx) => (
                  <FieldValueInput
                    key={`${fv.label}-${idx}`}
                    item={item}
                    field={fv}
                    locked={locked}
                    onChange={onChange}
                    textarea
                  />
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            {remainingFields.map((fv, idx) => (
              <FieldValueInput
                key={`${fv.label}-${idx}`}
                item={item}
                field={fv}
                locked={locked}
                onChange={onChange}
              />
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-2 gap-2">
          {remainingFields.map((fv, idx) => (
            <FieldValueInput
              key={`${fv.label}-${idx}`}
              item={item}
              field={fv}
              locked={locked}
              onChange={onChange}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function productTone(index: number) {
  const tones = [
    {
      card: "border-[#cfe0ff] bg-[#f7faff]",
      rail: "bg-[#3b7be8]",
      name: "bg-white text-[#173b8f]",
      model: "[&>div]:border-[#cfe0ff] [&>div]:bg-[#eef5ff]"
    },
    {
      card: "border-[#cdebdc] bg-[#f6fcf9]",
      rail: "bg-[#2c9f6b]",
      name: "bg-white text-[#176044]",
      model: "[&>div]:border-[#cdebdc] [&>div]:bg-[#effaf4]"
    },
    {
      card: "border-[#f3d9b8] bg-[#fffaf2]",
      rail: "bg-[#d88a24]",
      name: "bg-white text-[#7a4a0c]",
      model: "[&>div]:border-[#f3d9b8] [&>div]:bg-[#fff4e4]"
    },
    {
      card: "border-[#dfd5f3] bg-[#fbf8ff]",
      rail: "bg-[#7b61b5]",
      name: "bg-white text-[#4d3783]",
      model: "[&>div]:border-[#dfd5f3] [&>div]:bg-[#f5efff]"
    }
  ];
  return tones[index % tones.length];
}

function FieldValueInput({
  item,
  field,
  locked,
  onChange,
  wide,
  textarea
}: {
  item: PiItem;
  field: PiItem["fieldValues"][number];
  locked: boolean;
  onChange: (it: PiItem) => void;
  wide?: boolean;
  textarea?: boolean;
}) {
  const update = (value: string) =>
    onChange({
      ...item,
      fieldValues: item.fieldValues.map((x) => (x.label === field.label ? { ...x, value } : x))
    });
  const options = field.fieldType === "DROPDOWN" ? field.options ?? [] : [];
  return (
    <Field label={field.label}>
      {textarea ? (
        <textarea
          className="w-full"
          disabled={locked}
          rows={3}
          value={field.value}
          onChange={(e) => update(e.target.value)}
        />
      ) : options.length > 0 ? (
        <select
          className={wide ? "w-full" : undefined}
          disabled={locked}
          value={field.value}
          onChange={(e) => update(e.target.value)}
        >
          <option value="">Select...</option>
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
      ) : (
        <input
          className={wide ? "w-full" : undefined}
          disabled={locked}
          value={field.value}
          onChange={(e) => update(e.target.value)}
        />
      )}
    </Field>
  );
}
