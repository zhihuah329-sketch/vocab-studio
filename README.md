# 词页 · 英语练习工作台（Windows 桌面版）

Windows 安装包请从 [GitHub Releases](https://github.com/zhihuah329-sketch/vocab-studio/releases) 下载。

把“不背单词”或其他工具导出的词表导入桌面应用，或者使用 AI 生成词表，再选择练习模式：

首页提供背单词、阅读、考试、翻译、AI 词表、个人数据和设置入口；在总览、个人数据与设置页面自动收起左侧词表栏以提供更宽敞的视图，窄窗口中也可随时收起词表。支持浅色、深色、海蓝、淡紫、暖纸五种主题。

- **个人数据**：展示连续学习天数、累计已学/已掌握单词数、今日背词量、考试阅读平均分、近 30 天学习趋势柱状图、各词书学习进度条以及最近 AI 练习历史，并支持设置个人昵称。
- **设置**：集中管理 AI 接口（支持 Buddy Desktop 一键探测、Ollama、OpenAI 与自定义接口，提供“测试连接”按钮）、深浅色外观切换，以及学习数据 JSON 导出与练习记录清理。

- **背单词**：内置七类非官方词书（中考、高考、四级、六级、考研、雅思、GRE），也可把导入或 AI 生成的词加入“我的词表”。每本词书可分别设置每天新学词数（1–100）和最多复习词数（0–200）；页面显示今日完成量与预计学完新词的日期。支持普通记忆与拼写练习；显示音标、词典例句，优先播放词典音频，缺失时使用系统朗读。到期词优先复习，当天未完成的任务可继续，计划和进度在本机保存。
- **阅读短文**：用所选词生成英文短文和中文译文，支持目标词高亮、覆盖统计、复制及 Markdown 导出。选中英文单词或句子时会调用已配置的 AI 接口显示中文翻译。
- **等级考试阅读**：选择高考、英语四级、英语六级、考研英语或雅思，生成原创模拟阅读文章和 5 道选择题；作答后显示分数、正确答案和解析。文章同样支持选中翻译。
- **翻译训练**：生成 5 道汉译英或英译汉题目，填写自己的译文后对照参考译文和表达提示。
- **AI 生成词表**：按等级、数量和主题生成带中文释义与英文例句的单词表；可加入练习词表或导出 CSV。

考试阅读与翻译训练可以不导入词表直接使用；有选中单词时，生成内容会尽量自然融入它们。考试练习为原创模拟题，不是官方真题。

## 使用

运行 `dist/VocabStudio-Setup-4.2.0.exe` 安装后，从开始菜单打开“词页英语练习工作台”。也可直接双击免安装版 `dist/词页英语练习工作台.exe`。程序使用系统 WebView2 显示独立桌面窗口；关闭窗口后本地服务会退出。若尚未打包，可在本目录运行 `py app.py`。

导入支持 TXT、CSV、TSV、XLSX。每行一个单词，或将英文单词放在第一列。文本文件支持 UTF-8 和 GB18030。可选任意数量的目标单词，但过多单词可能超出所用模型的上下文或生成能力。

在“AI 接口”中选择 Buddy Desktop、Ollama、OpenAI 或自定义地址。Buddy Desktop 使用其本机 OpenAI 兼容代理；点击“启动本机 Buddy”可启动已安装的客户端，再点击“检测 Buddy 与模型”读取本机服务状态和模型列表，默认地址是 `http://127.0.0.1:5178/v1/chat/completions`。首次使用仍需在 Buddy 中登录并准备可用模型。程序不读取 Buddy Desktop 的账号库或凭据。

自定义接口请填完整的 **Chat Completions API URL** 和模型名称。API Key 可留空，适合无需鉴权的本地模型；需要鉴权的服务则按其要求填写。URL、模型及深浅色主题保存在本机 `%LOCALAPPDATA%\VocabStudio\settings.json`，跨启动保留；Key 不保存，重启后需要重新输入。背词记录保存在同一目录下的 `study.json`。

示例：

- Ollama 本地：`http://127.0.0.1:11434/v1/chat/completions`，模型填写你已在 Ollama 安装的模型名称，Key 留空。
- OpenAI：`https://api.openai.com/v1/chat/completions`，填写可用模型名称和 API Key。

生成请求会发送至你填写的 API URL。原始词表文件只在本机处理；发送给模型的是选中的单词、难度、篇幅和主题。第三方 API 可能收费。应用不读取“不背单词”账号或 Cookie；需要你先取得导出的词表文件。目前不支持 PDF/Word 词表。

内置词书根据 [ECDICT](https://github.com/skywind3000/ECDICT) 开放词典的考试标签筛选，中文释义来自该词典，并非考试机构指定词表。词典按 MIT 许可使用，许可文本见 `data/ECDICT_LICENSE.txt`。若要从 ECDICT 的 `ecdict.csv` 重新生成词书，把该文件放在本目录并运行 `py build_wordbooks.py`。

## 开发与打包

```powershell
py -m pip install -r requirements.txt
.\build_setup.ps1
```

需要 Python、Inno Setup 6 或 7，以及 Windows 的 Microsoft Edge WebView2 Runtime。脚本会运行测试、生成免安装 EXE，并编译 `setup.iss`。打包结果位于 `dist/`；安装包默认装到当前用户的 `%LOCALAPPDATA%\Programs\VocabStudio`，无需管理员权限，安装和卸载不会清除学习记录。简体中文安装文本来自 [Inno Setup 源码仓库](https://github.com/jrsoftware/issrc/blob/main/Files/Languages/ChineseSimplified.isl)。
