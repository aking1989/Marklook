# 墨览打印验证文档

这份文档用于验证阅读视图的打印与 PDF 导出效果，覆盖中文排版、标题分页、长代码行、表格、引用、列表与脚注。

## 一、中文正文

阅读是一种需要被认真对待的界面。墨览把阅读放在第一位：字号、行高、栏宽都可以调整，文章本身永远是页面的主角。打印时应用外壳会被隐藏，只保留文章内容，并按 A4 纸张重新排版。

这一段落用于检查中文的字距、行距与首行对齐。中文排版不缩进首行，段落之间留出半行间距，标点应使用全角，行末不应出现孤字。英文与数字混排时，Word 与 Markdown 应保持一致的基线。

The quick brown fox jumps over the lazy dog. 0123456789. 这段混排用于检查中英文基线是否一致，以及行尾换行是否自然。

## 二、标题与分页

### 2.1 三级标题

标题不应与后续段落分离，打印时 `break-after: avoid` 负责这一行为。下面是一段较长的内容，用来把分页推到下一页。

Lorem ipsum dolor sit amet, consectetur adipiscing elit. Integer posuere erat a ante venenatis dapibus posuere velit aliquet. Cras mattis consectetur purus sit amet fermentum. Donec ullamcorper nulla non metus auctor fringilla. Maecenas faucibus mollis interdum. Vestibulum id ligula porta felis euismod semper.

### 2.2 二级标题下的列表

- 无序列表第一项
- 无序列表第二项，包含行内代码 `write_document` 与链接 [Tauri](https://tauri.app)
- 无序列表第三项

1. 有序列表第一项
2. 有序列表第二项
3. 有序列表第三项

- [x] 已验证的检查项
- [ ] 待验证的检查项

## 三、表格

| 检查项   | 预期         | 结果 |
| -------- | ------------ | ---- |
| 中文换行 | 行末无孤字   | 待填 |
| 表格分页 | 不跨页截断   | 待填 |
| 长代码行 | 自动折行     | 待填 |
| 引用样式 | 左侧竖线保留 | 待填 |
| 脚注     | 文末正确显示 | 待填 |

## 四、代码块

下面这段代码包含超过 100 个字符的长行，用于验证打印时是否折行而不是被裁切。

```rust
#[tauri::command]
pub fn write_document(path: String, content: String, expected_mtime_ms: Option<u64>, force: bool, eol: Eol, bom: bool, state: State<'_, AppState>) -> Result<WriteResultDto, CommandError> {
    let path = state.ensure_allowed(&path)?;
    let bytes = io::encode_text(&content, eol, bom);
    io::atomic_write(&path, &bytes)?;
    Ok(WriteResultDto { mtime_ms: 0, size: bytes.len() as u64, eol, bom })
}
```

```text
这一段是普通文本代码块。If a line of code is extremely long, it should wrap instead of being clipped by the page margin. 这是一句用来测试折行的中文内容，应当完整出现在 PDF 中。
```

## 五、引用与分隔线

> 好的阅读器应该消失在文字后面。
>
> 引用块在打印时保留左侧竖线，并且不应跨页断开。

---

## 六、脚注与行内元素

这里引用一个脚注[^1]，并包含 **加粗**、_斜体_、~~删除线~~ 与行内代码 `Cmd+E`。

[^1]: 脚注应在文末正确渲染，字号略小于正文。

## 七、超长不可断字符串

https://example.com/a/very/long/path/that/should/not/overflow/the/page/margin/abcdefghijklmnopqrstuvwxyz0123456789

## 八、结尾

如果以上内容在 PDF 中完整、清晰、无截断，则系统打印路线验证通过。
