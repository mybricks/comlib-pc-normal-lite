const tramsform = (code) => {
  return code
    .replace(/from\s+['"]mybricks['"]/g, "from '@mybricks/ai-render'")
    .replace(/(from\s+['"][^'"]+)\.less(['"]\s*)/g, '$1.module.less$2')
    .replace(/@PopupVisible/g, '');
}

export { tramsform }
