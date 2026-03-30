/**
 * ============================================================
 * image-inline.js  —  异步图片内联层
 * ============================================================
 * 职责：
 *   - fetchImageAsBase64DataUrl：fetch 远程图片并转为 base64 data URL
 *   - inlineImageFillsInTree：递归遍历 JSON 节点树，将所有图片 URL 内联为 base64
 * 规则：此层为异步（返回 Promise），不参与主流程 walk，仅在用户选择「带图片导出」时调用。
 * ============================================================
 */

/** 将 URL 转为 base64 data URL，供 Figma 插件直接解码使用。SVG 会先绘制到 Canvas 再转 PNG。失败时保留 url。 */
function fetchImageAsBase64DataUrl(url) {
  return fetch(url, { mode: 'cors' })
    .then(function (res) { return res.ok ? res.blob() : Promise.reject(new Error(res.statusText)); })
    .then(function (blob) {
      var mimeType = blob.type || '';
      if (mimeType.indexOf('svg') >= 0 || url.toLowerCase().endsWith('.svg')) {
        // SVG 转 PNG：通过 Image + Canvas 光栅化
        return new Promise(function (resolve, reject) {
          var reader = new FileReader();
          reader.onloadend = function () {
            var svgDataUrl = reader.result;
            var img = new window.Image();
            img.onload = function () {
              var canvas = document.createElement('canvas');
              canvas.width = img.naturalWidth || 400;
              canvas.height = img.naturalHeight || 400;
              var ctx = canvas.getContext('2d');
              ctx.drawImage(img, 0, 0);
              try {
                resolve(canvas.toDataURL('image/png'));
              } catch (e) {
                reject(e);
              }
            };
            img.onerror = reject;
            img.src = svgDataUrl;
          };
          reader.onerror = reject;
          reader.readAsDataURL(blob);
        });
      }
      // 非 SVG 直接转 base64 data URL
      return new Promise(function (resolve, reject) {
        var reader = new FileReader();
        reader.onloadend = function () { resolve(reader.result); };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });
    });
}

/** 递归将树中 style.fills 里 type===IMAGE 且仅有 url 的项，请求图片并写入 content（base64 data URL）。 */
function inlineImageFillsInTree(obj) {
  if (!obj) return Promise.resolve();
  var promises = [];

  // 处理 style.fills 里的 IMAGE fill
  var style = obj.style;
  if (style && style.fills && Array.isArray(style.fills)) {
    style.fills.forEach(function (fill, i) {
      if (fill && fill.type === 'IMAGE' && fill.url && !fill.content) {
        promises.push(
          fetchImageAsBase64DataUrl(fill.url).then(function (dataUrl) {
            style.fills[i] = { type: 'IMAGE', content: dataUrl };
          }).catch(function (err) {
            console.warn('[image fill] 内联失败', fill.url, err && err.message);
          })
        );
      }
    });
  }

  // 处理 type==='image' 节点的 content 字段（img 标签 src），将 URL 内联为 base64
  if (obj.type === 'image' && obj.content && typeof obj.content === 'string' && !obj.content.startsWith('data:')) {
    promises.push(
      fetchImageAsBase64DataUrl(obj.content).then(function (dataUrl) {
        obj.content = dataUrl;
      }).catch(function (err) {
        console.warn('[image node] 内联失败', obj.content, err && err.message);
      })
    );
  }

  return Promise.all(promises).then(function () {
    var children = obj.children;
    if (children && children.length) {
      return Promise.all(children.map(inlineImageFillsInTree));
    }
  });
}


if (typeof module !== 'undefined') {
  module.exports = {
    fetchImageAsBase64DataUrl: fetchImageAsBase64DataUrl,
    inlineImageFillsInTree: inlineImageFillsInTree,
  };
}
