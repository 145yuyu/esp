#!/bin/bash
# ============================================================
#  城市公园环境监测系统 — 云服务器一键部署脚本
#  适用于: 腾讯云 / 阿里云 CentOS 7+ 或 Ubuntu 18+
#
#  用法: bash server-setup.sh
# ============================================================
set -e

APP_DIR="/opt/park-monitor"
PORT=3000

echo "╔══════════════════════════════════════════╗"
echo "║    公园环境监测系统 - 服务器部署      ║"
echo "╚══════════════════════════════════════════╝"
echo ""

# ---- 1. 检测系统 ----
if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS=$ID
else
    echo "无法检测系统类型，退出"
    exit 1
fi
echo "[1/6] 系统: $OS"

# ---- 2. 安装 Node.js 18+ ----
echo "[2/6] 安装 Node.js..."
if ! command -v node &> /dev/null; then
    if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
        curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
        sudo apt-get install -y nodejs
    else
        # CentOS / TencentOS
        curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
        sudo yum install -y nodejs
    fi
fi
echo "   Node.js $(node -v) [OK]"
echo "   npm $(npm -v) [OK]"

# ---- 3. 创建应用目录 & 上传文件 ----
echo "[3/6] 部署应用文件..."
sudo mkdir -p $APP_DIR
sudo chown $USER:$USER $APP_DIR

# NOTE: Upload project files to server first
# 在你自己电脑上执行:
#   scp -r "D:\final work\backend\*" root@你的服务器IP:/opt/park-monitor/
#   scp -r "D:\final work\frontend" root@你的服务器IP:/opt/park-monitor/
#
# 如果文件已存在则跳过
if [ ! -f "$APP_DIR/server.js" ]; then
    echo ""
    echo "   [WARN] 请先上传项目文件到 $APP_DIR"
    echo ""
    echo "   在你自己电脑上执行以下命令:"
    echo ""
    echo "   scp -r backend/* root@服务器IP:$APP_DIR/"
    echo "   scp -r frontend   root@服务器IP:$APP_DIR/"
    echo ""
    echo "   上传完成后重新运行: bash $0"
    echo ""
    exit 0
fi
echo "   应用文件已就绪 [OK]"

# ---- 4. 安装依赖 ----
echo "[4/6] 安装项目依赖..."
cd $APP_DIR
npm install --production

# ---- 5. 安装 PM2 进程守护 ----
echo "[5/6] 安装 PM2..."
if ! command -v pm2 &> /dev/null; then
    sudo npm install -g pm2
fi

# 创建 PM2 配置
cat > $APP_DIR/ecosystem.config.js << 'PM2EOF'
module.exports = {
    apps: [{
        name: 'park-monitor',
        script: 'server.js',
        args: '--sim',
        cwd: '/opt/park-monitor',
        env: {
            NODE_ENV: 'production',
            PORT: 3000,
            SIMULATE: '1',
        },
        autorestart: true,
        max_restarts: 10,
        restart_delay: 3000,
        log_date_format: 'YYYY-MM-DD HH:mm:ss',
    }]
};
PM2EOF

pm2 delete park-monitor 2>/dev/null || true
pm2 start $APP_DIR/ecosystem.config.js
pm2 save
pm2 startup systemd -u $USER --hp $HOME 2>/dev/null || true

echo "   PM2 已启动 [OK]"

# ---- 6. 开放防火墙端口 ----
echo "[6/6] 配置防火墙..."
if [ "$OS" = "ubuntu" ] || [ "$OS" = "debian" ]; then
    sudo ufw allow $PORT/tcp 2>/dev/null || true
    sudo ufw allow 22/tcp 2>/dev/null || true
else
    sudo firewall-cmd --add-port=$PORT/tcp --permanent 2>/dev/null || true
    sudo firewall-cmd --reload 2>/dev/null || true
fi

# NOTE: Open port in cloud console security group!
echo ""
echo "   [WARN] 重要：登录云服务器控制台 → 安全组 → 添加入站规则:"
echo "   - 端口: $PORT"
echo "   - 协议: TCP"
echo "   - 授权: 0.0.0.0/0"
echo ""

# ---- 完成 ----
PUBLIC_IP=$(curl -s ifconfig.me 2>/dev/null || curl -s ip.sb 2>/dev/null || echo "服务器IP")

echo "╔══════════════════════════════════════════╗"
echo "║    部署完成！                          ║"
echo "╠══════════════════════════════════════════╣"
echo "║   公网地址: http://$PUBLIC_IP:$PORT       ║"
echo "║   管理命令:                               ║"
echo "║   pm2 status             查看状态         ║"
echo "║   pm2 logs park-monitor  查看日志         ║"
echo "║   pm2 restart park-monitor 重启服务       ║"
echo "║   pm2 stop park-monitor  停止服务         ║"
echo "╚══════════════════════════════════════════╝"
echo ""
echo "Open: http://$PUBLIC_IP:$PORT"
