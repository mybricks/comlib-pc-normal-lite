import React, {
  useMemo,
  createContext,
  useContext,
  Children,
  isValidElement,
  useState,
  useCallback,
  useEffect
} from "react";
import { getLazyCss } from "../utils/css";

import * as lazyCss from "./index.lazy.less";
const css = getLazyCss(lazyCss)

type TreeViewProps = {
  defaultCurrent: string;
  children: React.ReactNode;
  /** 需要强制展开的目录 id 列表 */
  expandIds?: string[];
  isDark?: boolean;
}

const TreeViewContext = createContext<{
  current: string;
  setCurrent: React.Dispatch<React.SetStateAction<string>>;
  expandIds: Set<string>;
  isDark: boolean;
}>({
  current: "",
  setCurrent: () => {},
  expandIds: new Set(),
  isDark: false,
})

const TreeView = (props: TreeViewProps) => {
  const [current, setCurrent] = useState(props.defaultCurrent);
  const expandIds = React.useMemo(
    () => new Set(props.expandIds ?? []),
    [props.expandIds]
  );

  // 当外部 defaultCurrent 变化时（如文件被删除后回退选择），同步更新内部 current
  useEffect(() => {
    if (props.defaultCurrent) {
      setCurrent(props.defaultCurrent);
    }
  }, [props.defaultCurrent]);

  const dark = props.isDark ?? false;
  // #9198a1
  const cssVars = {
    '--tree-item-toggle': dark ? "#999" : "#999",
    '--tree-directory-icon': dark ? '#999' : '#999',
    '--tree-item-visual': dark ? ' #999' : '#999',
    '--tree-item-text': dark ? '#f0f6fc' : '#1f2328',
    '--tree-item-leval-line': dark ? '#3d444db3' : '#d1d9e0b3'
  } as React.CSSProperties;

  return (
    <TreeViewContext.Provider
      value={{
        current,
        setCurrent,
        expandIds,
        isDark: dark,
      }}
    >
      <ul className={css.treeView} style={cssVars}>
        {props.children}
      </ul>
    </TreeViewContext.Provider>
  )
}

TreeView.displayName = "TreeView";

type ItemProps = {
  id: string;
  hasSubTree: boolean; // [TODO] 引擎环境里这样使用，受rxui影响，非引擎环境用useSubTree
  leadingVisual: React.ReactNode; // [TODO] 引擎环境里这样使用，受rxui影响，非引擎环境用useSlots
  contentText: string; // [TODO] 引擎环境里这样使用，受rxui影响，非引擎环境用useSubTree
  onSelect?: () => void;
  onContextMenu?: (event: React.MouseEvent<HTMLLIElement, MouseEvent>) => void;
  children: React.ReactNode;
}

const ItemContext = createContext({
  level: 1,
  isExpanded: false,
})

const Item = (props: ItemProps) => {
  const { current, setCurrent, expandIds } = useContext(TreeViewContext)
  const { level } = useContext(ItemContext);
  // const [slots, rest] = useSlots(props.children, {
  //   leadingVisual: LeadingVisual,
  // })
  // const { hasSubTree, subTree, childrenWithoutSubTree } = useSubTree(rest);
  const [isExpanded, setIsExpanded] = useState(false); // 默认不展开

  // 外部要求展开时强制展开
  useEffect(() => {
    if (expandIds.has(props.id)) {
      setIsExpanded(true);
    }
  }, [expandIds, props.id]);
  
  const handleItemCLick = (event: React.MouseEvent<HTMLLIElement, MouseEvent>) => {
    if (props.onSelect) {
      props.onSelect();
      setCurrent(props.id);
    } else {
      // 无法选中，展开
      setIsExpanded((isExpanded) => {
        return !isExpanded
      })
    }
    event.stopPropagation();
  }

  const handleToggleClick = useCallback((event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
    setIsExpanded((isExpanded) => {
      return !isExpanded
    })
    event.stopPropagation();
  }, [])

  return (
    <ItemContext.Provider
      value={{
        level: level + 1,
        isExpanded,
      }}
    >
      <li
        className={css.item}
        aria-current={(current === props.id) ? 'true' : undefined}
        onClick={handleItemCLick}
        onContextMenu={props.onContextMenu}
      >
        <div data-hasnot-subTree={props.hasSubTree ? undefined : true} className={css.itemContainer}>
          <div style={{height: "100%"}}>
            <LevelIndicatorLines level={level} />
          </div>
          {props.hasSubTree ? (
            <div
              className={css.itemToggle}
              onClick={handleToggleClick}
            >
              {isExpanded ? ChevronDownIcon : ChevronRightIcon}
            </div>
          ) : null}
          <div className={css.itemContent}>
            {/* {slots.leadingVisual} */}
            <LeadingVisual>
              {props.leadingVisual}
            </LeadingVisual>
            <span className={css.itemContentText}>
              {/* {childrenWithoutSubTree} */}
              {props.contentText}
            </span>
          </div>
        </div>
        {/* {subTree} */}
        {props.children}
        {/* [TODO] 引擎环境里这样使用，受rxui影响，非引擎环境用useSubTree */}
      </li>
    </ItemContext.Provider>
  )
}

Item.displayName = "TreeView.Item";

type LevelIndicatorLinesProps = {
  level: number;
}

const LevelIndicatorLines = (props: LevelIndicatorLinesProps) => {
  return (
    <div
      style={{ "--level": props.level } as any}
      className={css.itemLevelLineContainer}
    >
      {Array.from({ length: props.level - 1 }).map((_, index) => {
        return (
          <div key={index} className={css.itemLevelLine}/>
        )
      })}
    </div>
  )
}

type SubTreeProps = {
  children: React.ReactNode;
}

const useSubTree = (children: React.ReactNode) => {
  return useMemo(() => {
    const subTree = Children.toArray(children).find(
      child => isValidElement(child) && (child.type === SubTree || (child as any).type.displayName === "TreeView.SubTree"),
    )

    const childrenWithoutSubTree = Children.toArray(children).filter(
      child => !(isValidElement(child) && (child.type === SubTree || (child as any).type.displayName === "TreeView.SubTree")),
    )

    return {
      subTree,
      childrenWithoutSubTree,
      hasSubTree: Boolean(subTree),
    }
  }, [children])
}

const SubTree = (props: SubTreeProps) => {
  const { isExpanded } = useContext(ItemContext);

  if (!isExpanded) {
    return null;
  }

  return (
    <ul className={css.subTree}>
      {props.children}
    </ul>
  )
}

SubTree.displayName = "TreeView.SubTree";

type LeadingVisualProps = {
  children: React.ReactNode;
}

const LeadingVisual = (props: LeadingVisualProps) => {
  return (
    <div className={css.itemVisual}>
      {props.children}
    </div>
  )
}

LeadingVisual.displayName = "TreeView.LeadingVisual";

const DirectoryIcon = () => {
  const { isExpanded } = React.useContext(ItemContext)
  const Icon = isExpanded ? FileDirectoryOpenFillIcon : FileDirectoryFillIcon
  return (
    <div className={css.directoryIcon}>
      {Icon}
    </div>
  )
}

export type SlotConfig = Record<string, React.ElementType<any>>

const useSlots = <Config extends SlotConfig>(children: React.ReactNode, config: Config) => {
  const slots: Record<keyof Config, React.ReactNode> = mapValues(config, () => undefined)
  const rest: React.ReactNode[] = []

  const keys = Object.keys(config);
  const values = Object.values(config)

  React.Children.forEach(children, child => {
    if (!React.isValidElement(child)) {
      rest.push(child)
      return
    }

    const index = values.findIndex(value => {
      if (Array.isArray(value)) {
        const [component, testFn] = value
        return child.type === component && testFn(child.props)
      } else {
        return child.type === value
      }
    })

    if (index === -1) {
      rest.push(child)
      return
    }

    const slotKey = keys[index]

    if (slots[slotKey]) {
      // console.warn(true, `Found duplicate "${String(slotKey)}" slot. Only the first will be rendered.`)
      return
    }

    (slots as Record<string, any>)[slotKey] = child;
  })

  return [slots, rest] as [Record<keyof Config, React.ReactNode>, React.ReactNode[]];
}

/** Map the values of an object */
const mapValues = <T extends Record<string, unknown>, V>(obj: T, fn: (value: T[keyof T]) => V) => {
  return Object.keys(obj).reduce(
    (result, key: keyof T) => {
      result[key] = fn(obj[key])
      return result
    },
    {} as Record<keyof T, V>,
  )
}

const FileDirectoryOpenFillIcon = <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M.513 1.513A1.75 1.75 0 0 1 1.75 1h3.5c.55 0 1.07.26 1.4.7l.9 1.2a.25.25 0 0 0 .2.1H13a1 1 0 0 1 1 1v.5H2.75a.75.75 0 0 0 0 1.5h11.978a1 1 0 0 1 .994 1.117L15 13.25A1.75 1.75 0 0 1 13.25 15H1.75A1.75 1.75 0 0 1 0 13.25V2.75c0-.464.184-.91.513-1.237Z"/></svg>;

const FileDirectoryFillIcon = <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" fill="currentColor" viewBox="0 0 16 16"><path d="M1.75 1A1.75 1.75 0 0 0 0 2.75v10.5C0 14.216.784 15 1.75 15h12.5A1.75 1.75 0 0 0 16 13.25v-8.5A1.75 1.75 0 0 0 14.25 3H7.5a.25.25 0 0 1-.2-.1l-.9-1.2C6.07 1.26 5.55 1 5 1H1.75Z"/></svg>;

const ChevronDownIcon = <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 12 12"><path d="M6 8.825c-.2 0-.4-.1-.5-.2l-3.3-3.3c-.3-.3-.3-.8 0-1.1.3-.3.8-.3 1.1 0l2.7 2.7 2.7-2.7c.3-.3.8-.3 1.1 0 .3.3.3.8 0 1.1l-3.2 3.2c-.2.2-.4.3-.6.3Z"/></svg>;

const ChevronRightIcon = <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" fill="currentColor" viewBox="0 0 12 12"><path d="M4.7 10c-.2 0-.4-.1-.5-.2-.3-.3-.3-.8 0-1.1L6.9 6 4.2 3.3c-.3-.3-.3-.8 0-1.1.3-.3.8-.3 1.1 0l3.3 3.2c.3.3.3.8 0 1.1L5.3 9.7c-.2.2-.4.3-.6.3Z"/></svg>;


export default Object.assign(TreeView, {
  Item,
  SubTree,
  DirectoryIcon,
  LeadingVisual
});
