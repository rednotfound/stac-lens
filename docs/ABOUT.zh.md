# 关于 STAC Lens

STAC Lens 是一个免费、开源、纯浏览器端的工具，用来查看任何 [STAC](https://stacspec.org/)（SpatioTemporal Asset Catalog，时空资产目录）目录或 API 的**形状、健康状况和真实行为**。粘贴一个目录 URL，它就把发布者的目录结构画成一棵树，把时间和空间覆盖范围画在旁边，并标出元数据自相矛盾或不符合规范的地方。没有任何数据上传：每一个请求都从你的浏览器直接发往你正在查看的那个目录。

线上地址是 [staclens.com](https://staclens.com/)，也可以用 [GitHub 上的源码](https://github.com/rednotfound/stac-lens)（Apache-2.0）[自行部署](/deploy/)。

## 它是做什么的

STAC 是描述地理空间数据的开放标准——卫星遥感影像、航空影像、数字高程模型、气候格网、矢量图层——以 Collection 和 Item 组成目录，每个 Item 带有地理范围、时间和可下载的 asset。全世界有数百个公开的 STAC 目录，来自 NASA、ESA、微软 Planetary Computer、Element 84、各国测绘机构和研究团队。STAC Lens 是架在这些目录之上的一面"透镜"，回答逐字段浏览器回答不了的三个问题：

- **形状。** 发布者到底是怎样组织这份数据的？层层嵌套，还是一个根下面平铺四百个 Collection？Item 在哪里，有多少？
- **健康。** 元数据在哪里自相矛盾、在哪里不符合标准？两个互不相交的空间范围、`rel:collection` 与 `rel:parent` 指向不一致、已废弃的 license 值、包不住自己各部分的总范围。
- **与规范的距离。** 一个 API *声明*自己支持什么，被真正请求时又*做了*什么？STAC Lens 发出真实请求，报告两者的差异。

## 给谁用

- **在选数据源的人**——在写第一行代码之前，先看清一个目录的组织方式、时空覆盖、API 是否守规矩。首页列出了[一百多个公开目录](/catalogs/)，每一个都经过验证：在线、是真正的 STAC、能从浏览器读取。
- **检查自己目录的发布者**——你发布出去的结构长什么样，问题标在哪里。Schema 校验器检查 JSON 写得对不对；这里检查 JSON *做起来*对不对。
- **学习 STAC 的人**——Catalog → Collection → Item 的模型、extent、link、API 能力，用同一套视觉语言呈现，而不是一堆文档。
- **STAC 社区**——真实世界中一致性状况的经验视角。这个应用从真实服务器上学到的每一件事都记录在项目的[设计日志](https://github.com/rednotfound/stac-lens/blob/main/docs/DESIGN.md)里，连同证实它的那些请求。

## 不是另一个 STAC Browser

[STAC Browser](https://github.com/radiantearth/stac-browser) 是 STAC 的参考浏览器，它把自己的工作做得很好。STAC Lens 不是它的替代品，也不打算成为替代品。

| | STAC Browser | STAC Lens |
|---|---|---|
| 目的 | 读一个目录：每个对象、每个字段，忠实呈现 | 理解一个目录：它的形状、健康、真实行为 |
| 部署 | 每个目录一个实例，由发布者配置 | 一个实例，任何目录——粘贴 URL 即可 |
| 视图单位 | 当前对象（每个 Catalog / Collection / Item 一页） | 整张图，时间与空间并列 |
| 对服务器 | 信任 | 实际请求，报告它真正做了什么 |
| 元数据问题 | 有什么显示什么 | 标出矛盾与废弃写法，绝不悄悄"修正" |
| Item 浏览 | 完整 | 刻意保持"够用"——列表、分页、时间轴、地图 |

如果你发布目录、希望访客阅读它，请部署 STAC Browser。如果你想看清一个目录*是什么*——自己的或别人的——请在 STAC Lens 里打开它。

## 这里的"健康"是什么意思

健康不是一个分数，而是一份发现清单，每一条都能追溯到别人写下的规则：STAC 核心规范、它的最佳实践文档、社区 linter [stac-check](https://github.com/stac-utils/stac-check)、[STAC API](https://github.com/radiantearth/stac-api-spec) 规范，以及 [stac-api-validator](https://github.com/stac-utils/stac-api-validator) 的方法（声明的一致性 vs. 实际响应）。没有任何规则是本项目发明的。没有规则可依时——比如根下平铺 422 个 Collection、一个 Collection 有几百万个 Item——这件事只作为**观察**报告，绝不当作问题。

应用已实现或可以实现的每一条规则，连同来源、严重等级、是否已构建，都列在[健康规则](/health-rules/)页上。规则有稳定的编号（`C-04`、`A-02`、`S-01`），一条发现可以被引用。

## 原则

- **不枚举无法枚举的东西。** 一个五千一百万 Item 的 Collection 通过 API 自己的游标一页一页看。没有"全部加载"。
- **不发明结构。** 树显示的就是发布者做的层级——平的地方就是平的。没有客户端分组，没有合成节点，没有数据源没给的计数。
- **失败就显示为失败。** 被拒绝的请求显示为带有服务器原话的错误信息，绝不是一个空结果。
- **声明的与观察到的。** API 在 conformance class 里声明的能力显示为"声明"；服务器实际的行为只在发出真实请求后显示，并引用请求和响应。
- **按一致性声明决定界面。** 依赖某项服务器能力的控件，只在服务器声明了该能力时才存在。
- **直接操作优于控件。** 拖拽平移、滚轮缩放、拖分隔条调整大小；窗口有标题栏；地图默认平移，只有选中工具时才画框。
- **什么都不离开浏览器。** 没有后端、没有代理、没有统计脚本。你打开的目录是唯一看到你请求的服务器。

## 词汇

本站使用的术语，按 STAC 规范的含义给出简短定义。

- **STAC**——SpatioTemporal Asset Catalog，时空资产目录：一个开放规范（也是 OGC 社区标准），把地理空间资产描述为相互链接的 JSON 文档，使任何提供者的数据都能以同样的方式被检索。
- **Catalog（目录）**——链接到其他 Catalog、Collection 或 Item 的 JSON 文档。它是 STAC 的"文件夹"：结构，不是数据。
- **Collection（集合）**——带有一组连贯数据元数据的 Catalog：许可、空间范围（一个或多个 bbox）、时间范围（一个或多个区间）、summaries。一个 Collection 通常装着一个产品的全部 Item，例如 Sentinel-2 Level-2A。
- **Item（条目）**——一个 GeoJSON Feature，带有时间、地理范围和一个或多个 Asset。一景影像、一个瓦片、一组文件。
- **Asset（资产）**——指向真实文件（COG、Parquet 表、缩略图）的链接，带媒体类型和角色。
- **静态目录**——放在 Web 服务器或对象存储上的一棵 JSON 文件树，沿链接遍历。
- **STAC API**——提供同样对象并增加检索的 Web 服务：`/search` 支持 `bbox`、`datetime`、`collections`，通过 `next` 链接分页。
- **Conformance class（一致性类）**——STAC API 在首页 `conformsTo` 里声明的能力列表。STAC Lens 读取它来决定显示哪些控件，然后检查服务器是否兑现了声明。
- **Extent（范围）**——Collection 声明的覆盖。空间上是 bbox 数组，第一项必须是总范围；时间上是区间数组，第一项必须是总区间。
- **健康发现**——目录违反规范性规则（invalid）、忽略建议（warning）或行为与声明不符（behavior）的地方。见[规则列表](/health-rules/)。

## 关键词

STAC Lens 是面向开放地理数据的 STAC 目录查看器与健康检查器：遥感影像、对地观测、GIS 与测绘数据、气候与高程格网、开放数据目录。英文说明见 [About STAC Lens](/about/)。

## 项目事实

- **许可：** Apache-2.0。**源码：** [github.com/rednotfound/stac-lens](https://github.com/rednotfound/stac-lens)。
- **技术栈：** TypeScript、React、Vite、D3、Leaflet。没有后端。
- **STAC 版本：** 1.0 与 1.1；STAC API Core、Features、Item Search，以及[健康规则](/health-rules/)页列出的扩展。
- **代码是怎么写出来的：** 大部分由 AI 编程助手完成，由一位设计师指挥和审阅，并在真实浏览器里对着真实目录驱动验证。它能用、有测试，也一定还有没被发现的错误。看起来不对的地方，多半就是不对——[请告诉我们](https://github.com/rednotfound/stac-lens/issues)。
- **引用：** 仓库带有 `CITATION.cff`，GitHub 的 "Cite this repository" 按钮会读取它。
