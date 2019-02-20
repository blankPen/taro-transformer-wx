import traverse, { Binding, NodePath } from 'babel-traverse'
import generate from 'babel-generator'
import * as fs from 'fs'
import { prettyPrint } from 'html'
import { transform as parse } from 'babel-core'
import * as ts from 'typescript'
import { Transformer } from './class'
import { setting, findFirstIdentifierFromMemberExpression, isContainJSXElement, codeFrameError, isArrayMapCallExpression } from './utils'
import * as t from 'babel-types'
import { DEFAULT_Component_SET, INTERNAL_SAFE_GET, TARO_PACKAGE_NAME, REDUX_PACKAGE_NAME, MOBX_PACKAGE_NAME, IMAGE_COMPONENTS, INTERNAL_INLINE_STYLE, THIRD_PARTY_COMPONENTS, INTERNAL_GET_ORIGNAL, setLoopOriginal, GEL_ELEMENT_BY_ID } from './constant'
import { Adapters, setAdapter, Adapter } from './adapter'
import { Options, setTransformOptions } from './options'
import { get as safeGet } from 'lodash'
import { eslintValidation } from './eslint'

const template = require('babel-template')

function getIdsFromMemberProps (member: t.MemberExpression) {
  let ids: string[] = []
  const { object, property } = member
  if (t.isMemberExpression(object)) {
    ids = ids.concat(getIdsFromMemberProps(object))
  }
  if (t.isThisExpression(object)) {
    ids.push('this')
  }
  if (t.isIdentifier(object)) {
    ids.push(object.name)
  }
  if (t.isIdentifier(property)) {
    ids.push(property.name)
  }
  return ids
}

  /**
   * TS 编译器会把 class property 移到构造器，
   * 而小程序要求 `config` 和所有函数在初始化(after new Class)之后就收集到所有的函数和 config 信息，
   * 所以当如构造器里有 this.func = () => {...} 的形式，就给他转换成普通的 classProperty function
   * 如果有 config 就给他还原
   */
function resetTSClassProperty (body: (t.ClassMethod | t.ClassProperty)[]) {
  for (const method of body) {
    if (t.isClassMethod(method) && method.kind === 'constructor') {
      if (t.isBlockStatement(method.body)) {
        method.body.body = method.body.body.filter(statement => {
          if (t.isExpressionStatement(statement) && t.isAssignmentExpression(statement.expression)) {
            const expr = statement.expression
            const { left, right } = expr
            if (
              t.isMemberExpression(left) &&
              t.isThisExpression(left.object) &&
              t.isIdentifier(left.property)
            ) {
              if (
                (t.isArrowFunctionExpression(right) || t.isFunctionExpression(right))
                ||
                (left.property.name === 'config' && t.isObjectExpression(right))
              ) {
                const classProp = t.classProperty(left.property, right)
                body.push(classProp)
                handleThirdPartyComponent(classProp)
                return false
              }
            }
          }
          return true
        })
      }
    }
  }
}

function findDeclarationScope (path: NodePath<t.Node>, id: t.Identifier) {
  const scopePath = path.findParent(p => !!p.scope.getOwnBindingIdentifier(id.name))
  if (scopePath) {
    return scopePath
  }
  throw codeFrameError(path.node, '该引用从未被定义')
}

function buildFullPathThisPropsRef (id: t.Identifier, memberIds: string[], path: NodePath<t.Node>) {
  const scopePath = findDeclarationScope(path, id)
  const binding = scopePath.scope.getOwnBinding(id.name)
  if (binding) {
    const bindingPath = binding.path
    if (bindingPath.isVariableDeclarator()) {
      const dclId = bindingPath.get('id')
      const dclInit = bindingPath.get('init')
      let dclInitIds: string[] = []
      if (dclInit.isMemberExpression()) {
        dclInitIds = getIdsFromMemberProps(dclInit.node)
        if (dclId.isIdentifier()) {
          memberIds.shift()
        }
        if (dclInitIds[0] === 'this' && dclInitIds[1] === 'props') {
          return template(dclInitIds.concat(memberIds).join('.'))().expression
        }
      }
    }
  }
}

function handleThirdPartyComponent (expr: t.ClassMethod | t.ClassProperty) {
  if (t.isClassProperty(expr) && expr.key.name === 'config' && t.isObjectExpression(expr.value)) {
    const properties = expr.value.properties
    for (const prop of properties) {
      if (
        t.isObjectProperty(prop) &&
        (t.isIdentifier(prop.key, { name: 'usingComponents' }) || t.isStringLiteral(prop.key, { value: 'usingComponents' })) &&
        t.isObjectExpression(prop.value)
      ) {
        for (const value of prop.value.properties) {
          if (t.isObjectProperty(value)) {
            if (t.isStringLiteral(value.key)) {
              THIRD_PARTY_COMPONENTS.add(value.key.value)
            }
            if (t.isIdentifier(value.key)) {
              THIRD_PARTY_COMPONENTS.add(value.key.name)
            }
          }
        }
      }
    }
  }
}

export interface Result {
  template: string
  components: {
    name: string,
    path: string,
    type: string
  }[],
  componentProperies: string[]
}

interface TransformResult extends Result {
  code: string,
  ast: t.File
}

export default function transform (options: Options): TransformResult {
  if (options.adapter) {
    setAdapter(options.adapter)
  }
  if (Adapter.type === Adapters.swan) {
    setLoopOriginal('privateOriginal')
  }
  THIRD_PARTY_COMPONENTS.clear()
  setTransformOptions(options)
  // 如果是 typescript 代码使用 ts.transpile 转换为 esnext 代码
  const code = options.isTyped
    ? ts.transpile(options.code, {
      jsx: ts.JsxEmit.Preserve, // 保留jsx语法
      target: ts.ScriptTarget.ESNext,
      importHelpers: true,
      noEmitHelpers: true
    })
    : options.code
  options.env = Object.assign({ 'process.env.TARO_ENV': options.adapter || 'weapp' }, options.env || {})
  setting.sourceCode = code
  // babel-traverse 无法生成 Hub
  // 导致 Path#getSource|buildCodeFrameError 都无法直接使用
  // 原因大概是 babylon.parse 没有生成 File 实例导致 scope 和 path 原型上都没有 `file`
  // 将来升级到 babel@7 可以直接用 parse 而不是 transform
  const ast = parse(code, {
    parserOpts: {
      sourceType: 'module',
      plugins: [
        'classProperties',
        'jsx',
        'flow',
        'flowComment',
        'trailingFunctionCommas',
        'asyncFunctions',
        'exponentiationOperator',
        'asyncGenerators',
        'objectRestSpread',
        'decorators',
        'dynamicImport'
      ] as any[]
    },
    plugins: [
      require('babel-plugin-transform-flow-strip-types'),
      [require('babel-plugin-transform-define').default, options.env]
    ].concat(process.env.ESLINT === 'false' || options.isNormal ? [] : eslintValidation).concat((process.env.NODE_ENV === 'test') ? [] : require('babel-plugin-remove-dead-code').default)
  }).ast as t.File
  if (options.isNormal) {
    return { ast } as any
  }
  // transformFromAst(ast, code)
  let result
  const componentSourceMap = new Map<string, string[]>()
  const imageSource = new Set<string>()
  const importSources = new Set<string>()
  let componentProperies: string[] = []
  let mainClass!: NodePath<t.ClassDeclaration>
  let storeName!: string
  let renderMethod!: NodePath<t.ClassMethod>
  let isImportTaro = false
  traverse(ast, {
    TemplateLiteral (path) {
      const nodes: t.Expression[] = []
      const { quasis, expressions } = path.node
      let index = 0
      if (path.parentPath.isTaggedTemplateExpression()) {
        return
      }
      for (const elem of quasis) {
        if (elem.value.cooked) {
          nodes.push(t.stringLiteral(elem.value.cooked))
        }

        if (index < expressions.length) {
          const expr = expressions[index++]
          if (!t.isStringLiteral(expr, { value: '' })) {
            nodes.push(expr)
          }
        }
      }

      // + 号连接符必须保证第一和第二个 node 都是字符串
      if (!t.isStringLiteral(nodes[0]) && !t.isStringLiteral(nodes[1])) {
        nodes.unshift(t.stringLiteral(''))
      }

      let root = nodes[0]
      for (let i = 1; i < nodes.length; i++) {
        root = t.binaryExpression('+', root, nodes[i])
      }
      path.replaceWith(root)
    },
    ClassDeclaration (path) {
      // 将找到的类的节点存起来，其实这里可以看出，taro默认一个文件只有一个 class
      mainClass = path
      /**
       * 下面这里的目的其实就是当你引用了自定义的组件并且继承了他，这是taro需要把你继承的这个源码也进行编译
       */
      const superClass = path.node.superClass
      // 先判断这个类必须是有继承的 也就是 class A extends XXX {}
      if (t.isIdentifier(superClass)) {
        const binding = path.scope.getBinding(superClass.name)
        // 再判断这个被继承的XXX在之前已经声明过
        if (binding && binding.kind === 'module') {
          const bindingPath = binding.path.parentPath
          // 第三步判断这个声明语句是导入宣言
          if (bindingPath.isImportDeclaration()) {
            /**
             * 此时匹配到的代码是这样
             * import XXX from 'xxx';
             * class A extends XXX {}
             */
            const source = bindingPath.node.source
            try {
              // 这里 p = 'xxx.js' || 'xxx.tsx'
              const p = fs.existsSync(source.value + '.js') ? source.value + '.js' : source.value + '.tsx'
              const code = fs.readFileSync(p, 'utf8')
              componentProperies = transform({
                isRoot: false,
                isApp: false,
                code,
                isTyped: true,
                sourcePath: source.value,
                outputPath: source.value
              }).componentProperies
            } catch (error) {
              // 文件 xxx.js || xxx.tsx 不存在
            }
          }
        }
      }
    },
    ClassExpression (path) {
      mainClass = path as any
    },
    ClassMethod (path) {
      if (t.isIdentifier(path.node.key) && path.node.key.name === 'render') {
        renderMethod = path
      }
    },
    IfStatement (path) {
      const consequent = path.get('consequent')
      /**
       * 这里是判断 if() 节点的后一个节点是不是 {} 节点，如果不是就给他加上
       * if (a) xxx()
       * 替换成
       * if (a) { xxx() }
       */
      if (!consequent.isBlockStatement()) {
        consequent.replaceWith(
          t.blockStatement([
            consequent.node as any
          ])
        )
      }
    },
    // 调用表达式
    // func() this.func() arr.map(()={}) 只要有函数调用都算
    CallExpression (path) {
      const callee = path.get('callee')
      // isContainJSXElement 这里是遍历的 path 的所有子节点看里面有没有JSXElement，如果有啥都不处理
      if (isContainJSXElement(path)) {
        return
      }
      // 被调用者的引用是成员表达式
      // this.func() arr.map()
      if (callee.isReferencedMemberExpression()) {
        /**
         * 找到被调用者的成员中最靠前的一个标识符
         * 如：
         * this.func() => id 就是 this
         * arr.map() => id 就是 arr
         */
        const id = findFirstIdentifierFromMemberExpression(callee.node)
        /**
         * getIdsFromMemberProps就是找到调用者的所有成员的 name
         * a.b.c.d()  => calleeIds = ['a','b','c','d'];
         */
        const calleeIds = getIdsFromMemberProps(callee.node)
        if (t.isIdentifier(id) && id.name.startsWith('on') && Adapters.alipay !== Adapter.type) {
          // 到了这一步被调用者的代码应该是 onXXXX.xxx() || onXXXX.xxx.xxx();
          /**
           * 解释下buildFullPathThisPropsRef，大概如下
           * 如果：
           * const onXXX = this.props.xxx;
           * onXXX.call(this, arg1, arg2);
           * --- 编译后,此时 fullPath 有值
           * this.props.xxx();
           * 
           * const onXXX = other;
           * onXXX.call(this, arg1, arg2);
           * --- 编译后,此时 fullPath 为空
           * onXXX();
           */
          const fullPath = buildFullPathThisPropsRef(id, calleeIds, path)
          if (fullPath) {
            path.replaceWith(
              t.callExpression(
                fullPath,
                path.node.arguments
              )
            )
          }
        }
      }
      // 被调用者的引用是标识符
      // func()
      if (callee.isReferencedIdentifier()) {
        const id = callee.node
        const ids = [id.name]
        if (t.isIdentifier(id) && id.name.startsWith('on')) {
          // 到了这一步被调用者的代码应该是 onXXXX();
          // 之后的处理和上面一样
          const fullPath = buildFullPathThisPropsRef(id, ids, path)
          if (fullPath) {
            path.replaceWith(
              t.callExpression(
                fullPath,
                path.node.arguments
              )
            )
          }
        }
      }
    },
    // JSXIdentifier (path) {
    //   const parentPath = path.parentPath
    //   if (!parentPath.isJSXAttribute()) {
    //     return
    //   }
    //   const element = parentPath.parentPath
    //   if (!element.isJSXOpeningElement()) {
    //     return
    //   }
    //   const elementName = element.get('name')
    //   if (!elementName.isJSXIdentifier()) {
    //     return
    //   }
    //   if (DEFAULT_Component_SET.has(elementName.node.name)) {
    //     return
    //   }

    //   const expr = parentPath.get('value.expression')

    // },
    JSXElement (path) {
      /**
       * 下面这块代码是有bug的，不太重要，可以忽略
       * 本意可见 => https://github.com/NervJS/taro/issues/550
       * 
       * 实际结果如下：
       * let a; a = [1,2,3].map(v => <View>{v}</View>);
       * --- 编译后
       * let a = <View>{v}</View>;
       * --- 期望结果
       * let a = [1,2,3].map(v => <View>{v}</View>);
       */
      const assignment = path.findParent(p => p.isAssignmentExpression())
      if (assignment && assignment.isAssignmentExpression()) {
        const left = assignment.node.left
        if (t.isIdentifier(left)) {
          const binding = assignment.scope.getBinding(left.name)
          if (binding && binding.scope === assignment.scope) {
            if (binding.path.isVariableDeclarator()) {
              // 错误的点其实就是不应该将path.node 直接赋值给 binding.path.node.init
              // 改成 binding.path.node.init = assignment.node.right 即可
              binding.path.node.init = path.node
              assignment.remove()
            } else {
              throw codeFrameError(path.node, '同一个作用域的JSX 变量延时赋值没有意义。详见：https://github.com/NervJS/taro/issues/550')
            }
          }
        }
      }
      /**
       * 如果是在 switch case 中的JSX会把 switch case切换成 if else
       * switch (v){ 
       * case 1: {
       *  any = <View1/>
       * }
       * case 2: { 
       *  <View2/>
       *  break;
       * }
       * default: {
       *  return <View3/>
       * }
       * }
       * --- 编译后
       * if(v === 1) { any = <View1/> }
       * else if(v === 2) { <View2/> }
       * else { return <View3/> }
       */
      const switchStatement = path.findParent(p => p.isSwitchStatement())
      if (switchStatement && switchStatement.isSwitchStatement()) {
        const { discriminant, cases } = switchStatement.node
        const ifStatement = cases.map((Case, index) => {
          const [ consequent ] = Case.consequent
          /**
           * 校验switch case 必须包含 {}
           * 所以不支持以下写法
           * case 1:
           * case 2: 
           *  return <View/>
           */
          if (!t.isBlockStatement(consequent)) {
            throw codeFrameError(switchStatement.node, '含有 JSX 的 switch case 语句必须每种情况都用花括号 `{}` 包裹结果')
          }
          const block = t.blockStatement(consequent.body.filter(b => !t.isBreakStatement(b)))
          if (index !== cases.length - 1 && t.isNullLiteral(Case.test)) {
            throw codeFrameError(Case, '含有 JSX 的 switch case 语句只有最后一个 case 才能是 default')
          }
          const test = Case.test === null ? t.nullLiteral() : t.binaryExpression('===', discriminant, Case.test)
          return { block, test }
        }).reduceRight((ifStatement, item) => {
          if (t.isNullLiteral(item.test)) {
            ifStatement.alternate = item.block
            return ifStatement
          }
          const newStatement = t.ifStatement(
            item.test,
            item.block,
            t.isBooleanLiteral(ifStatement.test, { value: false })
              ? ifStatement.alternate
              : ifStatement
          )
          return newStatement
        }, t.ifStatement(t.booleanLiteral(false), t.blockStatement([])))

        switchStatement.insertAfter(ifStatement)
        switchStatement.remove()
      }

      // 对for/for in/for of 进行禁用
      const isForStatement = (p) => p && (p.isForStatement() || p.isForInStatement() || p.isForOfStatement())

      const forStatement = path.findParent(isForStatement)
      if (isForStatement(forStatement)) {
        throw codeFrameError(forStatement.node, '不行使用 for 循环操作 JSX 元素，详情：https://github.com/NervJS/taro/blob/master/packages/eslint-plugin-taro/docs/manipulate-jsx-as-array.md')
      }
      /**
       * 处理 Array.prototype.map
       * 将 arr.map((v)=> v) 变成 arr.map((v)=> { return v; })
       */
      const loopCallExpr = path.findParent(p => isArrayMapCallExpression(p))
      if (loopCallExpr && loopCallExpr.isCallExpression()) {
        const [ func ] = loopCallExpr.node.arguments
        // 必须是箭头函数 并且没有 {}
        if (t.isArrowFunctionExpression(func) && !t.isBlockStatement(func.body)) {
          func.body = t.blockStatement([
            t.returnStatement(func.body)
          ])
        }
      }
    },
    /**
     * JSX开合元素
     * <View></View> -> JSXOpeningElement = <View>, JSXClosingElement = </View>
     * <View/> -> JSXOpeningElement = <View>, JSXClosingElement = null
     */
    JSXOpeningElement (path) {
      const { name } = path.node.name as t.JSXIdentifier
      /**
       * 找到<Provider />组件和store属性
       * 将组件改为View, 移除所有属性 
       * 
       * 这里很尬，taro只修改了 OpeningElement,没有处理CloseElement
       * 所以转换 <Provider store={store} >xxxx</Provider> => <View>xxxx</Provider>
       * 但是因为最后会转成wxml所以也没影响
       */
      if (name === 'Provider') {
        const modules = path.scope.getAllBindings('module')
        const providerBinding = Object.values(modules).some((m: Binding) => m.identifier.name === 'Provider')
        if (providerBinding) {
          path.node.name = t.jSXIdentifier('View')
          // 从<Provider store={myStore} >上找属性store，并且拿到传给store的值的名字
          const store = path.node.attributes.find(attr => attr.name.name === 'store')
          if (store && t.isJSXExpressionContainer(store.value) && t.isIdentifier(store.value.expression)) {
            // storeName = 'myStore'
            storeName = store.value.expression.name
          }
          path.node.attributes = []
        }
      }
      // IMAGE_COMPONENTS = ['Image', 'CoverImage']
      // 收集所有图片组件的src值，注意: 只能是字符串
      if (IMAGE_COMPONENTS.has(name)) {
        for (const attr of path.node.attributes) {
          if (
            attr.name.name === 'src'
          ) {
            if (t.isStringLiteral(attr.value)) {
              imageSource.add(attr.value.value)
            } else if (t.isJSXExpressionContainer(attr.value)) {
              if (t.isStringLiteral(attr.value.expression)) {
                imageSource.add(attr.value.expression.value)
              }
            }
          }
        }
      }
    },
    // 遍历JSX的属性 也就是 <View a={1} b={any} /> 上的 a={1} b={any}
    JSXAttribute (path) {
      const { name, value } = path.node
      // 过滤 name非 jsx关键字 或者 value 是 null、字符串、JSXElement
      // 即 any={null} any='123' any={<View />}
      if (!t.isJSXIdentifier(name) || value === null || t.isStringLiteral(value) || t.isJSXElement(value)) {
        return
      }

      const expr = value.expression as any
      const exprPath = path.get('value.expression')

      // 这里是向父级找类的名称 class Index {} -> classDeclName = 'Index';
      // 然后根据classDeclName来判断是否已经转换过
      const classDecl = path.findParent(p => p.isClassDeclaration())
      const classDeclName = classDecl && classDecl.isClassDeclaration() && safeGet(classDecl, 'node.id.name', '')
      let isConverted = false
      if (classDeclName) {
        isConverted = classDeclName === '_C' || classDeclName.endsWith('Tmpl')
      }

      /**
       * 处理内连样式
       * 将style={{ color: 'red' }} => style={internal_inline_style({ color: 'red' })}
       * 这里taro在全局上注入了一个函数 internal_inline_style
       */
      // 判断是style属性，且未转换过，正常来说我们写的代码都是未转换的，加这个逻辑应该是给taro内部一写组件使用
      if (!t.isBinaryExpression(expr, { operator: '+' }) && !t.isLiteral(expr) && name.name === 'style' && !isConverted) {
        const jsxID = path.findParent(p => p.isJSXOpeningElement()).get('name')
        if (jsxID && jsxID.isJSXIdentifier() && DEFAULT_Component_SET.has(jsxID.node.name)) {
          exprPath.replaceWith(
            t.callExpression(t.identifier(INTERNAL_INLINE_STYLE), [expr])
          )
        }
      }

      /**
       * 处理 onXxx 事件属性
       */
      if (name.name.startsWith('on')) {
        /**
         * 这里判断 onClick属性 他的值 是[引用表达式]
         * 即 onClick={myAdd}
         * 
         * 将 const myAdd = this.props.add; <Button onClick={myAdd} />
         * 转换成 <Button onClick={this.props.add} />
         */
        if (exprPath.isReferencedIdentifier()) {
          const ids = [expr.name]
          const fullPath = buildFullPathThisPropsRef(expr, ids, path)
          if (fullPath) {
            exprPath.replaceWith(fullPath)
          }
        }

        /**
         * 这里判断 onClick属性 他的值 是[引用成员表达式]
         * 即 onClick={a.add}
         * 
         * 下面这里的意思应该跟上面差不多
         * 将 const a = this.props; <Button onClick={a.add} />
         * 转换成 <Button onClick={this.props.add} />
         * 
         * 然而 const a = { add: this.props.add }; <Button onClick={a.add} />
         * 这种他就GG了
         */
        if (exprPath.isReferencedMemberExpression()) {
          const id = findFirstIdentifierFromMemberExpression(expr)
          const ids = getIdsFromMemberProps(expr)
          if (t.isIdentifier(id)) {
            const fullPath = buildFullPathThisPropsRef(id, ids, path)
            if (fullPath) {
              exprPath.replaceWith(fullPath)
            }
          }
        }

        // @TODO: bind 的处理待定
      }
    },
    ImportDeclaration (path) {
      const source = path.node.source.value
      if (importSources.has(source)) {
        throw codeFrameError(path.node, '无法在同一文件重复 import 相同的包。')
      } else {
        importSources.add(source)
      }
      const names: string[] = []
      // TARO_PACKAGE_NAME = '@tarojs/taro'
      if (source === TARO_PACKAGE_NAME) {
        /**
         * 如果文件中有import xx from '@tarojs/taro'
         * 会自动帮你多导入一些辅助函数
         * import xx, {
         *  internal_safe_get,
         *  internal_get_orignal,
         *  internal_inline_style,
         *  getElementById
         * } from '@tarojs/taro'
         * 
         */
        isImportTaro = true
        path.node.specifiers.push(
          t.importSpecifier(t.identifier(INTERNAL_SAFE_GET), t.identifier(INTERNAL_SAFE_GET)),
          t.importSpecifier(t.identifier(INTERNAL_GET_ORIGNAL), t.identifier(INTERNAL_GET_ORIGNAL)),
          t.importSpecifier(t.identifier(INTERNAL_INLINE_STYLE), t.identifier(INTERNAL_INLINE_STYLE)),
          t.importSpecifier(t.identifier(GEL_ELEMENT_BY_ID), t.identifier(GEL_ELEMENT_BY_ID))
        )
      }
      // REDUX_PACKAGE_NAME = '@tarojs/redux'
      // MOBX_PACKAGE_NAME = '@tarojs/mobx'
      if (
        source === REDUX_PACKAGE_NAME || source === MOBX_PACKAGE_NAME
      ) {
        path.node.specifiers.forEach((s, index, specs) => {
          if (s.local.name === 'Provider') {
            /**
             * 找到 import { Provider } from 'xxx'
             * 替换成
             * import { setStore } from 'xxx'
             */
            // 删除引入参数Provider
            specs.splice(index, 1)
            // 添加引入参数setStore
            specs.push(
              t.importSpecifier(t.identifier('setStore'), t.identifier('setStore'))
            )
          }
        })
      }
      /**
       * 1.遍历当前import语句收集所有导入的变量名
       * 2.将 import { Component } from '@tarojs/taro'
       * 替换成 import { __BaseComponent } from '@tarojs/taro'
       */
      path.traverse({
        ImportDefaultSpecifier (path) {
          const name = path.node.local.name
          DEFAULT_Component_SET.has(name) || names.push(name)
        },
        ImportSpecifier (path) {
          const name = path.node.imported.name
          DEFAULT_Component_SET.has(name) || names.push(name)
          if (source === TARO_PACKAGE_NAME && name === 'Component') {
            path.node.local = t.identifier('__BaseComponent')
          }
        }
      })
      componentSourceMap.set(source, names)
    }
  })

  if (!isImportTaro) {
    ast.program.body.unshift(
      t.importDeclaration([
        t.importDefaultSpecifier(t.identifier('Taro')),
        t.importSpecifier(t.identifier(INTERNAL_SAFE_GET), t.identifier(INTERNAL_SAFE_GET)),
        t.importSpecifier(t.identifier(INTERNAL_GET_ORIGNAL), t.identifier(INTERNAL_GET_ORIGNAL)),
        t.importSpecifier(t.identifier(INTERNAL_INLINE_STYLE), t.identifier(INTERNAL_INLINE_STYLE))
      ], t.stringLiteral('@tarojs/taro'))
    )
  }

  if (!mainClass) {
    throw new Error('未找到 Taro.Component 的类定义')
  }

  mainClass.node.body.body.forEach(handleThirdPartyComponent)
  const storeBinding = mainClass.scope.getBinding(storeName)
  mainClass.scope.rename('Component', '__BaseComponent')
  if (storeBinding) {
    const statementPath = storeBinding.path.getStatementParent()
    if (statementPath) {
      ast.program.body.forEach((node, index, body) => {
        if (node === statementPath.node) {
          body.splice(index + 1, 0, t.expressionStatement(
            t.callExpression(t.identifier('setStore'), [
              t.identifier(storeName)
            ])
          ))
        }
      })
    }
  }
  resetTSClassProperty(mainClass.node.body.body)
  if (options.isApp) {
    renderMethod.replaceWith(
      t.classMethod('method', t.identifier('_createData'), [], t.blockStatement([]))
    )
    return { ast } as TransformResult
  }
  result = new Transformer(mainClass, options.sourcePath, componentProperies).result
  result.code = generate(ast).code
  result.ast = ast
  result.compressedTemplate = result.template
  result.template = prettyPrint(result.template, {
    max_char: 0
  })
  result.imageSrcs = Array.from(imageSource)
  return result
}
