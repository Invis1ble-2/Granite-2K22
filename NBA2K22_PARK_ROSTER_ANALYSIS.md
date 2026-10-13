# NBA2K22 单人公园名单：本地2v2采样结果

本轮用户已完成正常Blacktop 2v2，确认日志有采样。实际读取游戏目录 `console logs/granite-20261013-133623.log`，采样钩子成功安装，记录两个AI球队、四个球员节点和四个非空名单指针。该轮有正常退出报告，未发现新的崩溃报告。

## 正常样本

| 球队采样顺序 | 球员 | 本进程名单地址 |
| --- | --- | --- |
| 0 | Tobias Harris | 0x7FF4CC3E9730 |
| 0 | Giannis Antetokounmpo | 0x7FF4CC3E9C60 |
| 1 | Joel Embiid | 0x7FF4CC3EA190 |
| 1 | Khris Middleton | 0x7FF4CC3EA6C0 |

名单地址均来自这次已经退出的进程，不能在下一次运行中直接使用，采样头部也不是完整可复制的球员资料。真人手柄具体控制哪名球员不由这份头部采样证明；不能据此称公园已经实现了一个真人和三个CPU。

## 旧崩溃的数据核对

读取 `granite-crash-20261013-131352-25956.dmp` 的模块表，自动取得NBA2K22实际模块基址，再按已核对的原生结构读取GameData两队。

- Home GameData地址为模块基址+0x630C310，Away为+0x630D568。
- `FUN_140948610(Team,4)` 用Team+0x1044处U32的高4位表示上场名单数量。
- `FUN_140948D90(Team,4,Index)` 读取Team+0xD0+Index*8，最多13个名单指针。
- 崩溃时Home标志原始字节24000c00，Away为24000e00，两边上场名单数量都为0，26个名单指针全部为空。并非已经建立了六个CPU名单后只是某一项坏掉。
- 前一轮服务日志记录了1真人+5个测试位置的开赛请求；客户端崩溃寄存器和指令确认在0x140979200通过空指针读取0xF8。

分析工具 `Granite/Server/Tools/AnalyzeParkRosterTrace.py` 支持MemoryList和Memory64List，使用模块表定位基址，不把缺失内存当零数据。已对真实采样和真实崩溃dump运行，结果为teams=2、players=4、valid_rosters=4、crash_counts=[0,0]。结构化结果保存为 `Granite/Server/Storage/Analysis/NBA2K22-ParkRoster-Baseline.json`。

## 原生名单绑定链

已核对Ghidra与解包构建：

1. 球员AI对象的vtable为0x142D5E1C8。虚函数+0x1A0指向0x141A2A4A0；原始指令 `48 8B 81 F0 0A 00 00 C3`，直接返回Player+0xAF0的名单指针。
2. `FUN_141A58110` 初始化时将该指针清零。构造AI对象本身不代表名单已建立。
3. `FUN_14197DA80`（AI_InitRosterData）先取得GameData两队的上场名单，再逐个对AI对象调用虚函数+0x1B0绑定名单。
4. 虚函数+0x1B0指向 `FUN_141AAD1E0`；它写入Player+0xAF0，并调用 `FUN_140979D90` 建立名单与AI对象的反向关联。因此不能只向AF0塞入一份字节快照来替代这条链。
5. 之后 `FUN_14197D550` 才读取这些名单，用 `FUN_140979200` 取名单+0xF8中的属性。上一轮就在这里崩溃。

公园的上游 `FUN_14169DA60`（TK_WORLD::SESSION::InitPlayingGame）按PUID查找客户端WORLD player，并通过 `FUN_141706A70`（TkWorld_AssignPlayerToTeam）填入球队。后者明确要求Player+0x21F0的BuildSource=1（USERDATA），并使用Player+0x446C0的球员资料对象及其+0x28的名单数据。服务器COURT中的名单ID和压缩资料不能替代这里所需的完整客户端WORLD player对象。

这些原生检查说明后续实现至少需要：有效的客户端球员对象及USERDATA建模来源、GameData两队名单、AI对象与名单双向绑定、真人控制器/CPU控制。尚未核实自动生成公园CPU所需的完整创建函数与生命周期，不能直接调用不完整的构造入口。

## 当前边界与下一步

公园单人入口仍未启用。采样证明本地街球能正常建立名单；尚未证明这套创建链可以直接用于公园，也未验收公园加载和开球。已有数据足够继续静态追踪，此时无需用户重复同一场Blacktop采样。

下一步从 `TkWorld_AssignPlayerToTeam` 使用的USERDATA球员对象向前追踪创建入口，核对虚拟补位角色怎样进入客户端WORLD player索引、怎样获得有效的资料/名单对象，以及怎样交给CPU控制。优先实现2v2的一个真人与三个CPU，完整对象链成立后再发送公园开赛状态。不要重启旧虚拟ID方案或直接复用退出进程的指针。
