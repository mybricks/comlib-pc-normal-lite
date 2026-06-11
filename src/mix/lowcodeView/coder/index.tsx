import React from 'react'

const Coder = () => {
  // {files.length === 0 ? (
  //   <div className={css['code-empty']}>暂无代码文件</div>
  // ) : (
  //   <>
  //     <div className={css['file-list']}>
  //       <TreeView
  //         defaultCurrent={selectFile?.fileName ?? "index.tsx"}
  //         expandIds={treeExpandIds}
  //         isDark={isDark}
  //       >
  //         <FilesTree
  //           nodes={filesJsonToTree(files)}
  //           onSelect={(file) => {
  //             setSelectFile(file)
  //           }}
  //         />
  //       </TreeView>
  //     </div>
  //     <div className={css['code-container']}>
  //       <Editor
  //         ref={codeIns}
  //         value={code}
  //         {...coderOptions}
  //         options={editorOptions}
  //         theme={editorTheme}
  //         wrapperClassName={css['coder']}
  //         loaderConfig={CODEEDITOR_LOADER_CONFIG}
  //         eslint={CODEEDITOR_ESLINT}
  //         onChange={handleEditorChange}
  //         onMount={handleEditorMount}
  //       />
  //     </div>
  //   </>
  // )}
  return (
    <div>
      代码编辑器
    </div>
  )
}

export default Coder
