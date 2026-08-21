# HKSI 项目部署指南

## 部署到 Vercel（推荐）

### 方法一：使用 GitHub Actions 自动部署（推荐）

1. 在 Vercel 上获取部署 Token：
   - 访问 https://vercel.com/account/tokens
   - 点击 "Create Token"，输入名称（如 "HKSI Deployment"）
   - 复制生成的 Token

2. 在 GitHub 仓库设置中添加 Secret：
   - 进入你的 GitHub 仓库 Settings → Secrets and variables → Actions
   - 点击 "New repository secret"
   - 名称：`VERCEL_TOKEN`
   - 值：粘贴刚才复制的 Vercel Token
   - 点击 "Add secret"

3. 代码推送到 main 分支后会自动部署

### 方法二：手动部署到 Vercel

#### 步骤 1：安装 Vercel CLI

```bash
# 方法 A：使用 npm（推荐）
npm install -g vercel

# 如果遇到权限问题，可以使用：
sudo npm install -g vercel

# 方法 B：使用 npx（无需安装）
# 直接在项目目录运行：
npx vercel
```

#### 步骤 2：登录 Vercel

```bash
vercel login
```

按照提示在浏览器中完成登录。

#### 步骤 3：部署项目

```bash
# 首次部署
vercel

# 后续部署到生产环境
vercel --prod
```

#### 步骤 4：自定义域名（可选）

1. 在 Vercel 控制台中选择你的项目
2. 进入 "Settings" → "Domains"
3. 添加你的自定义域名
4. 按照提示配置 DNS 记录

## 项目结构说明

- `hksi_mindmap.html` - 主应用文件，包含完整的 HKSI 学习系统
- `vercel.json` - Vercel 重写配置，确保根路径访问主应用
- `android-app/` - Android 应用源码和构建文件
- `output/` - 应用截图和文档
- `api/` - 同步 API 文件

## 部署注意事项

1. **静态文件托管**：Vercel 会自动识别这是一个静态网站项目
2. **路由重写**：`vercel.json` 中配置了重写规则，确保访问根路径时显示主应用
3. **缓存策略**：Vercel 会自动为静态资源设置缓存
4. **HTTPS**：Vercel 提供免费的 SSL 证书

## 访问部署后的网站

部署成功后，Vercel 会提供一个类似以下的 URL：
```
https://hksi.vercel.app
```

你可以在 Vercel 控制台中查看部署状态和访问日志。

## 开发与更新

### 本地开发
直接在浏览器中打开 `hksi_mindmap.html` 即可进行本地开发和测试。

### 更新部署
每次提交到 main 分支后，GitHub Actions 会自动触发部署流程。你也可以手动运行：

```bash
vercel --prod
```

## 故障排除

### 常见问题

1. **部署失败**：
   - 检查 Vercel Token 是否正确配置
   - 查看 GitHub Actions 日志中的错误信息

2. **无法访问网站**：
   - 检查 Vercel 控制台中的项目状态
   - 确认域名配置正确

3. **静态资源加载失败**：
   - 检查文件路径是否正确
   - 确认所有依赖文件都已提交到仓库

### 联系支持
如果遇到问题，可以：
- 查看 Vercel 文档：https://vercel.com/docs
- 检查 GitHub Actions 日志
- 联系项目维护者