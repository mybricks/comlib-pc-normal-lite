style.ts 需求文档

已知的是当前操作的 dom（ele），和需要设置的样式（style: CSSProperties）

我们可以拿到 ele 的 classname，ele 的 行内样式。

分析需要设置的样式，例如设置的样式为 { color: 'red' }

先查看 ele 的行内样式是否有 color ，有的话应该改行内样式，没有的话改 cssrule（代码中已经将 style 标签匹配出来了）。这里要改造下，因为一个元素，可能有多个classname，需要匹配出权重最高的（这里的决策你可以思考下是否有问题）

无论设置 行内样式 还是 cssrule，都要记录原始样式，后续会做为回退的值

总结：修改一个元素的样式，识别出是改行内还是css