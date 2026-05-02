# Excel 模版占位符填写指南

本系统只支持上传 `.xlsx`。模版里可以直接输入 `${...}` 占位符，导出 PI 时系统会替换成实际内容。

## 1. PI 主模版

主模版在 `Excel Template Settings` 页面上传，英文和中文各一份。

主模版适合放 PI 抬头、客户资料、发件人资料、Other Requirements、Total Amount，以及产品明细开始位置。

### 通用 PI 占位符

这些占位符可以放在主模版任意单元格：

| 内容 | 占位符 |
| --- | --- |
| PI No | `${piNo}` |
| Date | `${date}` |
| Customer Company | `${customer.company}` |
| Customer Contact | `${customer.contact}` |
| Customer Email | `${customer.email}` |
| Customer Phone | `${customer.phone}` |
| Customer Country | `${customer.country}` |
| Customer Address | `${customer.address}` |
| Sender Corp | `${sender.corp}` |
| Sender Address | `${sender.address}` |
| Sender From | `${sender.from}` |
| Sender Phone | `${sender.phone}` |
| Sender Email | `${sender.email}` |
| Other Requirements | `${otherRequirements}` |
| Total Amount | `${totalAmount}` |

### 英文 PI 专用占位符

| 内容 | 占位符 |
| --- | --- |
| Valid Until | `${validUntil}` |
| Incoterm | `${incoterm}` |
| Shipment Mode | `${shipmentMode}` |
| Payment Term | `${paymentTerm}` |

### 中文 PI 专用占位符

| 内容 | 占位符 |
| --- | --- |
| Production Order No. | `${productionOrderNo}` |
| Customer Source | `${customerSource}` |
| Customer Type | `${customerType}` |
| Delivery Date | `${deliveryDate}` |

## 2. 产品明细开始位置

系统需要知道产品明细从哪一行开始。

推荐做法：

1. 在 Excel 里选中第一条产品明细应该出现的单元格。
2. 给这个单元格设置名称，名称填写 `PRODUCTS_START`。
3. 上传主模版时 `Anchor Name` 保持默认 `PRODUCTS_START`。

备用做法：

在第一条产品明细应该出现的单元格中直接输入：

```text
${PRODUCTS_START}
```

## 3. 主模版中的产品行占位符

如果你希望产品行也按模版占位符填写，可以在 `PRODUCTS_START` 所在行放这些 token。系统会复制这一行的格式、边框和高度，然后逐个产品替换。

| 内容 | 占位符 |
| --- | --- |
| Product Name | `${item.productName}` |
| English Product Name | `${item.productNameEn}` |
| Chinese Product Name | `${item.productNameZh}` |
| Product Code | `${item.productCode}` |
| Model | `${item.model}` |
| Model Lines | `${item.modelLines}` |
| Order Code Meaning | `${item.orderCodeMeaning}` |
| Currency | `${item.currency}` |
| Quantity | `${item.quantity}` |
| Unit Price | `${item.unitPrice}` |
| Discount % | `${item.discountPct}` |
| Amount | `${item.amount}` |

例如一行可以这样放：

```text
${item.productName} | ${item.productCode} | ${item.model} | ${item.quantity} | ${item.unitPrice} | ${item.discountPct} | ${item.amount}
```

如果这一行没有 `${item...}` 或 `${field...}` 占位符，系统会使用默认列顺序：

英文：

```text
Product Name | Code | Model | Qty | Unit Price | Discount % | Amount
```

中文：

```text
Product Name | Code | Model | Qty
```

## 4. 产品子模版

产品子模版在产品编辑页面上传，英文和中文可以分别上传。

产品子模版适合放某个产品自己的参数区域，比如 Charging Interface、OCPP Platform、Wattage、Cable Configuration。

产品字段占位符格式：

```text
${field.字段名称}
```

字段名称必须和产品字段标签完全一致，包括空格和大小写。

例如：

| 字段 | 占位符 |
| --- | --- |
| Charging Interface | `${field.Charging Interface}` |
| OCPP Platform | `${field.OCPP Platform}` |
| Wattage | `${field.Wattage}` |
| Cable Configuration | `${field.Cable Configuration}` |

产品子模版也可以使用产品行占位符：

```text
${item.productName}
${item.productCode}
${item.model}
${item.quantity}
${item.unitPrice}
${item.amount}
```

## 5. 边框、合并单元格、页眉页脚

建议在 Excel 模版里先把边框、行高、列宽、合并单元格、页眉页脚设置好，再上传。

导出时系统会尽量保留：

- 主模版的单元格样式、页眉、页脚、打印设置。
- 产品行模版的边框、字体、填充、数字格式、行高。
- 产品子模版的边框、字体、填充、数字格式、行高、列宽、合并单元格。

如果某些边框仍然不显示，请检查源 Excel 中被合并区域的每个边缘单元格是否都有设置边框。合并单元格最好先设置完整外框后再上传。

### 页眉/页脚图片注意事项

不要把 logo 或图片放在 Excel 的 `页眉/页脚图片` 里。Excel 会用 `&G` 表示页眉/页脚图片，但当前导出库不能可靠保留这个图片本体，导出后可能只剩 `&G` 或图片消失。

稳定做法：

1. 把 logo 作为普通图片插入到工作表顶部单元格区域，例如 A1:C3。
2. 调整行高、列宽和打印区域，让它看起来像页眉。
3. 页眉/页脚里只放文字，例如页码、公司名、日期，不放图片。
