import { StyleSheet } from 'react-native';

const titleText = {
  color: '#ffffff',
  fontSize: 38,
  fontWeight: '800',
  letterSpacing: -0.5,
  marginBottom: 10,
}

const color = 'pink';

export default StyleSheet.create({
  scrollView: {
    flex: 1,
    backgroundColor: '#0f0f14',
  },
  scrollContent: {
    flexGrow: 1,
  },
  pageContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 24,
    paddingTop: 64,
    paddingBottom: 40,
    minHeight: '100%',
  },

  // 顶部 Logo 区域
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 48,
    gap: 10,
  },
  logoBlock: {
    width: 36,
    height: 36,
    borderRadius: 8,
    backgroundColor: '#4f6ef7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  logoText: {
    color: '#ffffff',
    fontSize: 14,
    fontWeight: '700',
    letterSpacing: 1,
  },
  headerTitle: {
    color: '#e8e8f0',
    fontSize: 18,
    fontWeight: '600',
    letterSpacing: 0.5,
  },

  // 主卡片
  card: {
    width: '100%',
    maxWidth: 480,
    backgroundColor: '#1a1a26',
    borderRadius: 20,
    paddingHorizontal: 32,
    paddingTop: 20,
    paddingBottom: 32,
    borderWidth: 1,
    borderColor: '#2a2a3e',
    shadowColor: '#4f6ef7',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
  },
  cardTopBar: {
    flexDirection: 'row',
    gap: 6,
    marginBottom: 32,
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#ff5f57',
  },
  dotYellow: {
    backgroundColor: '#ffbd2e',
  },
  dotGreen: {
    backgroundColor: '#28c840',
  },
  titleText: {
    color,
    fontSize: 38,
    fontWeight: '800',
    letterSpacing: -0.5,
    marginBottom: 10
  },
  subtitleText: {
    color: '#8888aa',
    fontSize: 15,
    fontWeight: '400',
    lineHeight: 22,
    marginBottom: 28,
  },
  divider: {
    height: 1,
    backgroundColor: '#2a2a3e',
    marginBottom: 24,
  },
  descriptionText: {
    color: '#c0c0d8',
    fontSize: 14,
    lineHeight: 22,
    marginBottom: 28,
  },
  badgeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },

  // 版本标签
  badgeWrapper: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 20,
    backgroundColor: '#24243a',
    borderWidth: 1,
    borderColor: '#3a3a56',
  },
  badgeText: {
    color: '#7878cc',
    fontSize: 12,
    fontWeight: '500',
    letterSpacing: 0.3,
  },

  // 加载占位
  loadingWrapper: {
    width: '100%',
    maxWidth: 480,
    height: 280,
    backgroundColor: '#1a1a26',
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  loadingText: {
    color: '#5555aa',
    fontSize: 14,
  },

  // 底部说明
  footer: {
    marginTop: 48,
    alignItems: 'center',
  },
  footerText: {
    color: '#44445a',
    fontSize: 12,
    letterSpacing: 0.5,
  },
});
