![DeepSeek Harness × 七牛 AgentAPI：在 DSH 对话里委派任务、跟进进度、收取文件](assets/readme/cover.png)

# AgentAPI for DeepSeek Harness

给 DeepSeek Harness 加一个能接活、能续聊的云端智能体。你可以让它核对一份表格、生成一份报告，或审阅一个指定版本的仓库。DSH 主智能体负责从对话里理清需求，七牛 AgentAPI 提供独立的云端工作区。运行中的发言、工具调用和最终交付物，都能从原来的对话找到。

[安装插件](#安装插件) · [试一次云端委派](#试一次云端委派) · [七牛 AgentAPI 产品主页](https://www.qiniu.com/products/agentapi)

| 你想做什么 | 在 DSH 里怎么做 |
| --- | --- |
| 把刚讨论好的方案交给云端 | 在主会话说「让云端智能体按第二种方案做」。主智能体会把前文里的方案和约束一起交代清楚。 |
| 看它做到哪一步了 | 打开标题栏的子智能体列表，点带云朵图标的那一项。可以实时读它的发言，也可以展开工具调用。 |
| 改要求、接着做 | 在云端子会话直接追问，或点击停止中断当前工作。之后再发消息，仍沿用同一个云端会话和已有文件。 |
| 拿到可以用的文件 | 指定要交付的文件名或格式。完成后，主会话会收到结果。打开子会话里的「查看云端记录」即可到七牛控制台下载产物。 |

## 安装插件

准备好 DeepSeek Harness 桌面版和一枚七牛 AgentAPI Key。本指南使用 DSH `0.2.2-rc.5`。[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) · [七牛 AgentAPI 控制台](https://portal.qiniu.com/agentapi)

1. 下载并解压插件，把解压出的 `dsh-agentapi-main` 文件夹放到打算保留的位置。[下载插件 ZIP](https://github.com/Misaki030112/dsh-agentapi/archive/refs/heads/main.zip)
2. 在 DSH 左侧打开 **插件 → 添加插件**。粘贴该文件夹在你电脑上的完整路径，点击 **安装**。
3. 安装完成后重启 DSH，设置中就会出现 **云端智能体**。

<img src="assets/readme/install.png" width="540" alt="DSH 添加插件窗口，在包名或地址栏填入解压目录的绝对路径，然后点安装">

## 连接七牛 AgentAPI

打开 **设置 → 云端智能体**，粘贴 AgentAPI Key，点击 **保存并连接**。页面提示 **已连接 AgentAPI，设置已保存。** 就可以开始。还没有 Key 时，点设置页的 **获取 API Key**。第一次可以保留默认的 **Native** 运行时。已有七牛 Agent 或云环境，也可以在 **高级设置** 中选择。

<img src="assets/readme/connect.png" width="500" alt="云端智能体设置，包含 API Key、运行时、模型和保存并连接按钮">

## 试一次云端委派

在 DSH 主会话发出下面这句话。这项任务不需要附件，跑完就能拿到一份 CSV。

> 请交给云端智能体核算周末市集预算。摊位费 240 元、物料 180 元、交通 90 元，预算上限 500 元。告诉我超支多少，把明细保存为 budget.csv。

<img src="assets/readme/first-task.png" width="690" alt="在 DSH 主会话输入周末市集的三项费用，要求云端智能体核算并交付 CSV">

也可以在输入框键入 `/`，选择 ☁️ **云端智能体**，再写下任务。派发后，打开标题栏的 **子智能体** 列表，点进这次的预算任务。

<img src="assets/readme/cloud-agent.png" width="365" alt="子智能体列表里的云朵标记、核算周末市集预算、已完成状态和用量">

这次运行的结果是 **合计 510 元，超支 10 元**。展开子会话可以看到逐项核算。点 **查看云端记录** 可以下载 `budget.csv`。想试试续聊，可以直接在下方问「如果交通费降到 70 元，还剩多少预算？请更新这份 CSV。」

<img src="assets/readme/result.png" width="610" alt="实际云端回复列出三项支出、510 元合计、10 元超支，以及 budget.csv 和查看云端记录入口">

要换成自己的材料，在主会话用文件选择器添加附件，告诉智能体要处理哪份文件、交付什么。代码任务也可以指定 Git commit，把对应版本的快照交给云端，取回可审阅的补丁。[七牛 AgentAPI 文档](https://developer.qiniu.com/agentapi)
