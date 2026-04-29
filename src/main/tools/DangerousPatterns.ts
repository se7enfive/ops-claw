import { RiskLevel } from '../types/security';

export interface DangerousPattern {
  pattern: RegExp;
  level: RiskLevel;
  reason: string;
  category: string;
  alternative?: string;
}

export interface SafeCommandPattern {
  pattern: RegExp;
  type: 'read' | 'network';
  description: string;
}

export const DANGEROUS_PATTERNS: DangerousPattern[] = [
  // ===== 极高风险（CRITICAL）=====
  {
    pattern: /^rm\s+(-[rf]+\s+)*\/$/,
    level: RiskLevel.CRITICAL,
    reason: '删除根目录将导致系统完全损坏',
    category: 'filesystem',
  },
  {
    pattern: /^rm\s+(-[rf]+\s+)*\/\*/,
    level: RiskLevel.CRITICAL,
    reason: '删除根目录下所有文件将导致系统损坏',
    category: 'filesystem',
  },
  {
    pattern: /^dd\s+.*of=\/dev\/(sd[a-z]|hd[a-z]|nvme)/,
    level: RiskLevel.CRITICAL,
    reason: '直接写入磁盘设备将破坏数据',
    category: 'disk',
  },
  {
    pattern: /:\(\)\s*{\s*:\|:&\s*};/,
    level: RiskLevel.CRITICAL,
    reason: 'Fork bomb 将耗尽系统资源',
    category: 'system',
  },
  {
    pattern: /^chmod\s+(-R\s+)?(777|a\+rwx)\s+\/$/,
    level: RiskLevel.CRITICAL,
    reason: '将根目录权限设为全开放极其危险',
    category: 'permission',
  },
  {
    pattern: /^mkfs\.(ext[234]|xfs|btrfs|ntfs|fat)\s+\/dev\/(sd|hd|nvme)/,
    level: RiskLevel.CRITICAL,
    reason: '格式化磁盘将删除所有数据',
    category: 'disk',
  },

  // ===== 高风险（HIGH）=====
  {
    pattern: /^rm\s+(-[rf]+\s+)/,
    level: RiskLevel.HIGH,
    reason: '强制删除文件/目录，无法恢复',
    category: 'filesystem',
    alternative: '建议先备份，使用 rm -i 进行交互式删除',
  },
  {
    pattern: /^kill\s+(-9\s+)?(\d+|\$PID|all)/,
    level: RiskLevel.HIGH,
    reason: '强制终止进程可能导致数据丢失或服务中断',
    category: 'process',
  },
  {
    pattern: /^shutdown|^reboot|^halt|^poweroff/,
    level: RiskLevel.HIGH,
    reason: '关机/重启命令将中断所有服务',
    category: 'system',
  },
  {
    pattern: /^iptables\s+(-F|-P\s+INPUT\s+DROP)/,
    level: RiskLevel.HIGH,
    reason: '清空防火墙规则可能导致安全暴露',
    category: 'network',
  },
  {
    pattern: /^chown\s+(-R\s+)?/,
    level: RiskLevel.HIGH,
    reason: '更改文件所有者可能影响服务运行',
    category: 'permission',
  },
  {
    pattern: /^chmod\s+(-R\s+)?(000|a-rwx)/,
    level: RiskLevel.HIGH,
    reason: '移除所有权限将导致文件不可访问',
    category: 'permission',
  },
  {
    pattern: /^curl.*\|\s*(sh|bash|zsh)/,
    level: RiskLevel.HIGH,
    reason: '从网络下载并直接执行脚本存在安全风险',
    category: 'network',
  },
  {
    pattern: /^wget.*\|\s*(sh|bash|zsh)/,
    level: RiskLevel.HIGH,
    reason: '从网络下载并直接执行脚本存在安全风险',
    category: 'network',
  },

  // ===== 中风险（MEDIUM）=====
  {
    pattern: /^(mkdir|touch|cp|mv|chmod|chown)\s+/,
    level: RiskLevel.MEDIUM,
    reason: '创建/复制/移动/权限变更等操作会修改系统状态',
    category: 'filesystem',
  },
  {
    pattern: /^service\s+\w+\s+(stop|restart)/,
    level: RiskLevel.MEDIUM,
    reason: '停止/重启服务将暂时中断功能',
    category: 'system',
  },
  {
    pattern: /^systemctl\s+(stop|restart|disable)\s+/,
    level: RiskLevel.MEDIUM,
    reason: '停止/重启/禁用服务将影响系统功能',
    category: 'system',
  },
  {
    pattern: /^docker\s+(rm|rmi|stop|kill)/,
    level: RiskLevel.MEDIUM,
    reason: 'Docker 操作可能影响容器运行',
    category: 'container',
  },
  {
    pattern: /^kubectl\s+(delete|scale\s+--replicas=0)/,
    level: RiskLevel.MEDIUM,
    reason: 'Kubernetes 删除/缩容操作将影响服务',
    category: 'container',
  },
  {
    pattern: /^(apt-get|yum|dnf|pacman|zypper)\s+(install|remove|upgrade|autoremove)/,
    level: RiskLevel.MEDIUM,
    reason: '软件包安装/卸载会更改系统环境',
    category: 'system',
  },

  // ===== 低风险（LOW）=====
  {
    pattern: /^mkdir\s+/,
    level: RiskLevel.LOW,
    reason: '创建目录',
    category: 'filesystem',
  },
  {
    pattern: /^touch\s+/,
    level: RiskLevel.LOW,
    reason: '创建/更新文件时间戳',
    category: 'filesystem',
  },
  {
    pattern: /^echo\s+/,
    level: RiskLevel.LOW,
    reason: '输出文本',
    category: 'filesystem',
  },
  {
    pattern: /^ln\s+/,
    level: RiskLevel.LOW,
    reason: '创建链接',
    category: 'filesystem',
  },
];

/** 安全命令库（白名单） */
export const SAFE_COMMANDS: SafeCommandPattern[] = [
  { pattern: /^ls/, type: 'read', description: '列出目录' },
  { pattern: /^pwd/, type: 'read', description: '显示当前目录' },
  { pattern: /^cat\s+/, type: 'read', description: '查看文件内容' },
  { pattern: /^head\s+/, type: 'read', description: '查看文件开头' },
  { pattern: /^tail\s+/, type: 'read', description: '查看文件结尾' },
  { pattern: /^less\s+/, type: 'read', description: '分页查看文件' },
  { pattern: /^more\s+/, type: 'read', description: '分页查看文件' },
  { pattern: /^grep\s+/, type: 'read', description: '搜索文本' },
  { pattern: /^find\s+/, type: 'read', description: '查找文件' },
  { pattern: /^which\s+/, type: 'read', description: '查找命令位置' },
  { pattern: /^whereis\s+/, type: 'read', description: '查找文件位置' },
  { pattern: /^whoami/, type: 'read', description: '显示当前用户' },
  { pattern: /^id/, type: 'read', description: '显示用户信息' },
  { pattern: /^uname/, type: 'read', description: '显示系统信息' },
  { pattern: /^hostname/, type: 'read', description: '显示主机名' },
  { pattern: /^date/, type: 'read', description: '显示日期' },
  { pattern: /^uptime/, type: 'read', description: '显示运行时间' },
  { pattern: /^free/, type: 'read', description: '显示内存状态' },
  { pattern: /^df/, type: 'read', description: '显示磁盘状态' },
  { pattern: /^du\s+/, type: 'read', description: '显示目录大小' },
  { pattern: /^ps/, type: 'read', description: '显示进程' },
  { pattern: /^top/, type: 'read', description: '显示进程状态' },
  { pattern: /^htop/, type: 'read', description: '交互式进程查看' },
  { pattern: /^netstat/, type: 'read', description: '显示网络状态' },
  { pattern: /^ss\s+/, type: 'read', description: '显示 socket 状态' },
  { pattern: /^ip\s+(addr|route|link)\s+show/, type: 'read', description: '显示网络配置' },
  { pattern: /^ifconfig/, type: 'read', description: '显示网络接口' },
  { pattern: /^ping\s+/, type: 'network', description: '网络连通测试' },
  { pattern: /^traceroute\s+/, type: 'network', description: '路由追踪' },
  { pattern: /^dig\s+/, type: 'network', description: 'DNS 查询' },
  { pattern: /^nslookup\s+/, type: 'network', description: 'DNS 查询' },
  { pattern: /^curl\s+(-I|--head)/, type: 'read', description: 'HTTP 头检查' },
  { pattern: /^wget\s+--spider/, type: 'read', description: 'URL 检查' },
  { pattern: /^docker\s+(ps|images|logs|inspect|stats)/, type: 'read', description: 'Docker 信息查看' },
  { pattern: /^kubectl\s+(get|describe|logs)/, type: 'read', description: 'Kubernetes 信息查看' },
  { pattern: /^git\s+(status|log|diff|branch|show)/, type: 'read', description: 'Git 信息查看' },
  { pattern: /^journalctl/, type: 'read', description: '查看系统日志' },
  { pattern: /^dmesg/, type: 'read', description: '查看内核消息' },
  { pattern: /^history/, type: 'read', description: '查看命令历史' },
  { pattern: /^env/, type: 'read', description: '显示环境变量' },
  { pattern: /^printenv/, type: 'read', description: '显示环境变量' },
];
