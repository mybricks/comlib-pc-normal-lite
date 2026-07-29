import React, { useState, useEffect } from 'react';
import { View, Text, ScrollView } from 'react-native';
import { comRef, logger } from 'mybricks';
import dataSource from '../../dataSource';
import styles from './styles';

interface HelloInfo {
  title: string;
  subtitle: string; 
  description: string;
  version: string;
}

/**
 * @mybricks
 * name: BadgeTag
 * title: 版本标签
 * summary: 展示版本号的小标签组件，接收版本文字通过 props 渲染。
 * type: com
 */
const BadgeTag = comRef(({ label }: { label: string }) => {
  return (
    <View style={styles.badgeWrapper}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
});

/**
 * @mybricks
 * name: HelloCard
 * title: Hello World 信息卡片
 * summary: 核心展示卡片，加载并渲染 Hello World 标题、副标题、描述及版本信息。
 * type: com
 * datasource:
 *   root:
 *     getHelloInfo:
 *       desc: 组件挂载时请求 Hello World 展示信息
 * state:
 *   titleText:
 *     helloInfo:
 *       desc: 存储从接口获取的 Hello World 信息，用于渲染标题、副标题、描述和版本
 *   loadingWrapper:
 *     loading:
 *       desc: 控制数据加载中的占位提示显示状态
 */
const HelloCard = comRef(() => {
  const [helloInfo, setHelloInfo] = useState<HelloInfo | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchData = async () => {
      logger.info('[HelloCard/useEffect] 开始请求 HelloWorld 信息');
      try {
        const result = await dataSource.getHelloInfo();
        logger.info('[HelloCard/useEffect] 请求成功', result);
        setHelloInfo(result);
      } catch (error) {
        logger.error('[HelloCard/useEffect] 请求失败', error);
      } finally {
        setLoading(false);
        logger.info('[HelloCard/useEffect] 加载状态已关闭');
      }
    };
    fetchData();
  }, []);

  if (loading) {
    return (
      <View style={styles.loadingWrapper}>
        <Text style={styles.loadingText}>加载中...</Text>
      </View>
    );
  }

  console.log('[styles]', styles)

  return (
    <View style={styles.card}>
      <View style={styles.cardTopBar}>
        <View style={styles.dot} />
        <View style={[styles.dot, styles.dotYellow]} />
        <View style={[styles.dot, styles.dotGreen]} />
      </View>
      <Text style={[styles.titleText, { color: 'red' }]}>{helloInfo?.title}</Text>
      <Text style={styles.subtitleText}>{helloInfo?.subtitle}</Text>
      <View style={styles.divider} />
      <Text style={styles.descriptionText}>{helloInfo?.description}</Text>
      <View style={styles.badgeRow}>
        <BadgeTag label={`v${helloInfo?.version}`} />
        <BadgeTag label="React Native" />
        <BadgeTag label="MyBricks" />
      </View>
    </View>
  );
});

/**
 * @mybricks
 * name: HelloWorldPage
 * title: Hello World 展示页
 * summary: 应用首页，渲染欢迎信息卡片，作为项目基础架构验证入口。
 * type: com
 */
const HelloWorldPage = comRef(() => {
  return (
    <ScrollView style={styles.scrollView} contentContainerStyle={styles.scrollContent}>
      <View style={styles.pageContainer}>
        <View style={styles.header}>
          <View style={styles.logoBlock}>
            <Text style={styles.logoText}>MB</Text>
          </View>
          <Text style={styles.headerTitle}>MyBricks</Text>
        </View>
        <HelloCard />
        <View style={styles.footer}>
          <Text style={styles.footerText}>基于 MyBricks 低代码平台构建</Text>
        </View>
      </View>
    </ScrollView>
  );
});

/**
 * @mybricks
 * name: Hello World 页面
 * title: Hello World 页面
 * summary: Hello World 页面
 * type: page
 */
export default comRef(() => {
  return (
    <HelloWorldPage />
  );
});
