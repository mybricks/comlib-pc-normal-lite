// /**
//  * 文档模型类
//  * 实际文档数据的存储和管理
//  */
// class DocumentModel {
//     constructor() {
//         this.content = '';  // 纯文本内容
//         this.formats = new Map(); // 简化的格式存储：位置 -> {bold: bool, italic: bool}
//     }
    
//     insert(position, text) {
//         if (position < 0 || position > this.content.length) {
//             throw new Error('插入位置无效');
//         }
//         this.content = this.content.slice(0, position) + text + this.content.slice(position);
//         // 调整格式信息的位置（简化处理，实际需要偏移所有受影响的格式）
//         this._shiftFormats(position, text.length);
//     }
    
//     delete(position, length) {
//         if (position < 0 || position + length > this.content.length) {
//             throw new Error('删除位置无效');
//         }
//         const deletedText = this.content.slice(position, position + length);
//         this.content = this.content.slice(0, position) + this.content.slice(position + length);
//         // 调整格式信息的位置
//         this._shiftFormats(position, -length);
//         return deletedText;
//     }
    
//     getText(start, length) {
//         return this.content.slice(start, start + length);
//     }
    
//     getLength() {
//         return this.content.length;
//     }
    
//     getFormat(position, formatType) {
//         // 简化实现
//         const formatsAtPos = this.formats.get(position) || {};
//         return formatsAtPos[formatType] || false;
//     }
    
//     setFormat(start, end, formatType, value) {
//         for (let i = start; i < end; i++) {
//             const formatsAtPos = this.formats.get(i) || {};
//             formatsAtPos[formatType] = value;
//             this.formats.set(i, formatsAtPos);
//         }
//     }
    
//     _shiftFormats(position, delta) {
//         // 简化：重新调整格式 Map 的键
//         const newFormats = new Map();
//         for (const [pos, formats] of this.formats) {
//             if (pos < position) {
//                 newFormats.set(pos, formats);
//             } else {
//                 newFormats.set(pos + delta, formats);
//             }
//         }
//         this.formats = newFormats;
//     }
    
//     // 获取当前完整内容（用于调试）
//     getContent() {
//         return this.content;
//     }
// }

// /**
//  * 编辑器的撤销/重做管理器
//  */
// class UndoRedoManager2 {
//     constructor(model, maxStackSize = 200) {
//         this.model = model;
//         this.undoStack = [];
//         this.redoStack = [];
//         this.maxStackSize = maxStackSize;
//         this.currentCursorPosition = 0;
        
//         // 用于合并操作的标志
//         this.lastCommand = null;
//         this.isMerging = false;
//     }
    
//     /**
//      * 执行一个命令并添加到历史
//      * @param {Command} command 
//      * @param {boolean} skipRedoClear 是否跳过清空重做栈（内部使用）
//      * @returns {number} 新的光标位置
//      */
//     execute(command, skipRedoClear = false) {
//         // 尝试与上一个命令合并
//         if (this.lastCommand && this.lastCommand.canMerge(command)) {
//             this.isMerging = true;
//             this.lastCommand.merge(command);
//             // 重新执行合并后的命令（先撤销旧的，再执行合并的）
//             this.lastCommand.undo();
//             const cursorPos = this.lastCommand.execute();
//             this.currentCursorPosition = cursorPos;
//             this.isMerging = false;
            
//             if (!skipRedoClear) {
//                 this.redoStack = [];
//             }
//             return cursorPos;
//         }
        
//         // 无法合并，正常执行
//         const cursorPos = command.execute();
//         this.currentCursorPosition = cursorPos;
        
//         // 添加到撤销栈
//         this.undoStack.push(command);
//         this.lastCommand = command;
        
//         // 限制栈大小
//         if (this.undoStack.length > this.maxStackSize) {
//             this.undoStack.shift();
//         }
        
//         // 执行新操作后清空重做栈（除非是内部调用）
//         if (!skipRedoClear) {
//             this.redoStack = [];
//         }
        
//         return cursorPos;
//     }
    
//     /**
//      * 撤销
//      * @returns {number} 新的光标位置
//      */
//     undo() {
//         if (this.undoStack.length === 0) {
//             console.log('没有可撤销的操作');
//             return this.currentCursorPosition;
//         }
        
//         const command = this.undoStack.pop();
//         const cursorPos = command.undo();
//         this.currentCursorPosition = cursorPos;
//         this.redoStack.push(command);
        
//         // 更新 lastCommand 引用
//         this.lastCommand = this.undoStack[this.undoStack.length - 1] || null;
        
//         return cursorPos;
//     }
    
//     /**
//      * 重做
//      * @returns {number} 新的光标位置
//      */
//     redo() {
//         if (this.redoStack.length === 0) {
//             console.log('没有可重做的操作');
//             return this.currentCursorPosition;
//         }
        
//         const command = this.redoStack.pop();
//         const cursorPos = command.execute();
//         this.currentCursorPosition = cursorPos;
//         this.undoStack.push(command);
        
//         // 更新 lastCommand 引用
//         this.lastCommand = command;
        
//         // 限制栈大小
//         if (this.undoStack.length > this.maxStackSize) {
//             this.undoStack.shift();
//         }
        
//         return cursorPos;
//     }
    
//     /**
//      * 判断是否可以撤销
//      */
//     canUndo() {
//         return this.undoStack.length > 0;
//     }
    
//     /**
//      * 判断是否可以重做
//      */
//     canRedo() {
//         return this.redoStack.length > 0;
//     }
    
//     /**
//      * 获取历史记录统计
//      */
//     getStats() {
//         return {
//             undoCount: this.undoStack.length,
//             redoCount: this.redoStack.length,
//             maxSize: this.maxStackSize
//         };
//     }
    
//     /**
//      * 清空所有历史
//      */
//     clear() {
//         this.undoStack = [];
//         this.redoStack = [];
//         this.lastCommand = null;
//         this.currentCursorPosition = 0;
//     }
    
//     /**
//      * 插入文本的便捷方法
//      */
//     insertText(position, text) {
//         const command = new InsertCommand(this.model, position, text);
//         return this.execute(command);
//     }
    
//     /**
//      * 删除文本的便捷方法
//      */
//     deleteText(position, length, deleteForward = false) {
//         // 获取要删除的文本
//         const text = this.model.getText(position, length);
//         const command = new DeleteCommand(this.model, position, text, deleteForward);
//         return this.execute(command);
//     }
    
//     /**
//      * 格式化文本的便捷方法
//      */
//     formatText(start, end, formatType, value) {
//         const command = new FormatCommand(this.model, start, end, formatType, value);
//         return this.execute(command);
//     }
// }

// /**
//  * 命令基类
//  * 所有编辑操作都需要继承这个类
//  */
// class Command2 {
//     constructor() {
//         // 用于合并操作的标识，相同类型的操作可以考虑合并
//         this.type = 'base';
//         // 合并时间窗口（毫秒）
//         this.mergeTimeWindow = 500;
//         this.timestamp = Date.now();
//     }
    
//     execute() {
//         throw new Error('execute() 方法必须由子类实现');
//     }
    
//     undo() {
//         throw new Error('undo() 方法必须由子类实现');
//     }
    
//     /**
//      * 检查是否可以与另一个命令合并
//      * @param {Command} other 另一个命令
//      * @returns {boolean}
//      */
//     canMerge(other) {
//         // 只有相同类型且在时间窗口内的命令才可以合并
//         return this.type === other.type && 
//                (other.timestamp - this.timestamp) <= this.mergeTimeWindow;
//     }
    
//     /**
//      * 合并另一个命令到当前命令
//      * @param {Command} other 
//      */
//     merge(other) {
//         // 由子类实现具体的合并逻辑
//         throw new Error('merge() 方法必须由需要支持合并的子类实现');
//     }
// }

// /**
//  * 插入文本命令
//  */
// class InsertCommand extends Command {
//     constructor(model, position, text) {
//         super();
//         this.type = 'insert';
//         this.model = model;
//         this.position = position;
//         this.text = text;
//     }
    
//     execute() {
//         this.model.insert(this.position, this.text);
//         // 返回新的光标位置（插入文本的末尾）
//         return this.position + this.text.length;
//     }
    
//     undo() {
//         // 逆操作：删除刚插入的文本
//         this.model.delete(this.position, this.text.length);
//         // 返回光标到原来的位置
//         return this.position;
//     }
    
//     canMerge(other) {
//         if (!super.canMerge(other)) return false;
//         if (!(other instanceof InsertCommand)) return false;
        
//         // 检查是否是连续输入（前一个命令的插入末尾正好是当前命令的开始）
//         const prevEndPos = this.position + this.text.length;
//         return prevEndPos === other.position;
//     }
    
//     merge(other) {
//         // 合并文本
//         this.text += other.text;
//         this.timestamp = other.timestamp;
//         return this;
//     }
// }

/**
 * 命令基类
 * 所有编辑操作都需要继承这个类
 */
// class Command {
//   constructor() {
//       // // 用于合并操作的标识，相同类型的操作可以考虑合并
//       // this.type = 'base';
//       // // 合并时间窗口（毫秒）
//       // this.mergeTimeWindow = 500;
//       // this.timestamp = Date.now();
//   }
  
//   execute() {
//       throw new Error('execute() 方法必须由子类实现');
//   }
  
//   undo() {
//       throw new Error('undo() 方法必须由子类实现');
//   }
  
//   /**
//    * 检查是否可以与另一个命令合并
//    * @param {Command} other 另一个命令
//    * @returns {boolean}
//    */
//   canMerge(other) {
//       // 只有相同类型且在时间窗口内的命令才可以合并
//       // return this.type === other.type && 
//       //         (other.timestamp - this.timestamp) <= this.mergeTimeWindow;
//   }
  
//   /**
//    * 合并另一个命令到当前命令
//    * @param {Command} other 
//    */
//   merge(other) {
//       // 由子类实现具体的合并逻辑
//       throw new Error('merge() 方法必须由需要支持合并的子类实现');
//   }
// }

// class UpdateFileCommand extends Command {
//   execute() {
//     this.model.insert(this.position, this.text);
//     // 返回新的光标位置（插入文本的末尾）
//     return this.position + this.text.length;
//   }
  
//   undo() {
//     // 逆操作：删除刚插入的文本
//     this.model.delete(this.position, this.text.length);
//     // 返回光标到原来的位置
//     return this.position;
//   }
// }

class Command {
  execute() {
    throw new Error('execute() 方法必须由子类实现');
  }
  
  undo() {
    throw new Error('undo() 方法必须由子类实现');
  }
}

/**
 * [TODO]
 * 1. 合并策略，目前样式编辑有防抖功能，用户修改后立即回滚可能看不到效果
 * 2. execute 支持配置默认不执行execute，在调用前已经执行过了（拖拽等连续快速修改场景）
 * 3. ai 修改是否需要撤回
 */
class UndoRedoManager {
  private maxStackSize = 50

  /** 撤回堆栈 */
  private undoStack: any[] = []

  /** 重做堆栈 */
  private redoStack: any[] = []

  /** 执行命令 */
  execute(command: Command) {
    command.execute()

    this.undoStack.push(command)
    this.redoStack = []

    // 限制栈大小
    if (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift();
    }
  }

  /** 撤销 */
  undo() {
    if (this.undoStack.length === 0) {
      // 没有可撤销操作
      return
    }
    
    const command = this.undoStack.pop()
    command.undo()

    this.redoStack.push(command)
  }

  /** 重做 */
  redo() {
    if (this.redoStack.length === 0) {
      // 没有可重做操作
      return
    }
    
    const command = this.redoStack.pop()
    command.execute()

    this.undoStack.push(command);
    
    // 限制栈大小
    if (this.undoStack.length > this.maxStackSize) {
      this.undoStack.shift();
    }
  }
}

const undoRedoManager = new UndoRedoManager()

export { undoRedoManager }


// ─── 默认导出：供编辑器快捷键系统调用 ────────────────────────────────────────
export default function() {
  return {
    /** 撤销 */
    '@undo'(params: { id: string }) {
      console.log('undo')
      undoRedoManager.undo()
    },
    /** 重做 */
    '@redo'(params: { id: string }) {
      console.log('redo')
      undoRedoManager.redo()
    }
  }
}
