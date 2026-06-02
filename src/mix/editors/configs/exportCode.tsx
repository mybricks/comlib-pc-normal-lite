import React, { useState, useEffect } from 'react';
import { RequirementViewModal } from '../../../utils/requirement-view';
import context from '../../context';
import type { Props, FigmaImportItem } from '../types';
import IconLibraryModal from './IconLibraryModal';
import styles from './style.lazy.less';

function ProjectActionsBar({ comId, props }: { comId: string; props: Props }) {
  const [prdVisible, setPrdVisible] = useState(false);
  const [iconLibVisible, setIconLibVisible] = useState(false);

  useEffect(() => {
    styles.use();
    return () => styles.unuse();
  }, []);

  const compiled = React.useMemo(() => {
    const files = context.component?.params?.data?.files;
    if (!files) return null;
    try {
      return (files as any[]).find((f: any) => f.fileName === 'requirement.md')?.compiled ?? null;
    } catch {
      return null;
    }
  }, [comId]);

  useEffect(() => {
    const events = context.component?.events as any;
    const handler = () => setPrdVisible(true);
    events.on('openDocs', handler, false);
    return () => events.off('openDocs', handler);
  }, [comId]);

  return (
    <div className={styles.locals.actionsBar}>
      {compiled && (
        <button type="button" className={styles.locals.actionBtn} onClick={() => setPrdVisible(true)}>
          查看PRD文档
        </button>
      )}
      <button type="button" className={styles.locals.actionBtn} onClick={() => setIconLibVisible(true)}>
        图标库设置
      </button>
      {prdVisible && compiled && (
        <RequirementViewModal compiled={compiled} onClose={() => setPrdVisible(false)} />
      )}
      <IconLibraryModal
        visible={iconLibVisible}
        params={props}
        comId={comId}
        mode="manage"
        onClose={() => setIconLibVisible(false)}
      />
    </div>
  );
}

export function buildExportCodeConfig(props: Props) {

  return [
    {
      title: '',
      type: 'editorRender',
      options: {
        render: () => <ProjectActionsBar comId={props.id} props={props} />,
      },
    },
    {
      title: 'Figma',
      type: 'figma',
      value: {
        get() {
          return {
            getCanvasList: () => context.getCanvasList(),
            onSync: (items: FigmaImportItem[], rootEl?: Element | null) => {}
          };
        },
      },
    }
    // {
    //   title: '导出',
    //   items: [
    //     {
    //       title: '代码',
    //       type: 'editorRender',
    //       options: {
    //         render: () => <ExportCodePanel comId={props.id} data={props.data} />,
    //       },
    //     },
    //   ],
    // },
    // {
    //   type: 'themes',
    //   value: {
    //     get(params: any) {
    //       if (params.data._themesModified) {
    //         return params.data.themes;
    //       }
    //       const projectThemes = context.projectConfig.themes;
    //       return (projectThemes && projectThemes.length > 0) ? projectThemes : params.data.themes;
    //     },
    //     set(params: any, themes: any) {
    //       params.data._themesModified = true;
    //       params.data.themes = themes;
    //     },
    //   },
    // },
  ];
}
