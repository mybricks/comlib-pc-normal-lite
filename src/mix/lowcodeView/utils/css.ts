const getLazyCss = (lazyCss) => {
  return lazyCss?.default?.locals || lazyCss
}

export { getLazyCss }
