const tramsform = (code) => {
  return code.replace(/from\s+['"]mybricks['"]/g, "from '@mybricks/ai-render'");
}

export { tramsform }
