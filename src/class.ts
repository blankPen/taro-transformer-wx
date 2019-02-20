import { NodePath } from 'babel-traverse'
import * as t from 'babel-types'
import {
  codeFrameError,
  hasComplexExpression,
  generateAnonymousState,
  findMethodName,
  pathResolver,
  createRandomLetters,
  isContainJSXElement,
  getSlotName,
  isArrayMapCallExpression
} from './utils'
import { DEFAULT_Component_SET } from './constant'
import { kebabCase, uniqueId } from 'lodash'
import { RenderParser } from './render'
import { findJSXAttrByName } from './jsx'
import { Adapters, Adapter } from './adapter'
import { LoopRef } from './interface'
import generate from 'babel-generator'

type ClassMethodsMap = Map<string, NodePath<t.ClassMethod | t.ClassProperty>>

function buildConstructor () {
  const ctor = t.classMethod(
    'constructor',
    t.identifier('constructor'),
    [t.identifier('props')],
    t.blockStatement([
      t.expressionStatement(
        t.callExpression(t.identifier('super'), [
          t.identifier('props')
        ])
      )
    ])
  )
  return ctor
}

function processThisPropsFnMemberProperties (
  member: t.MemberExpression,
  path: NodePath<t.CallExpression>,
  args: Array<t.Expression | t.SpreadElement>,
  binded: boolean
) {
  const propertyArray: string[] = []
  function traverseMember (member: t.MemberExpression) {
    const object = member.object
    const property = member.property

    if (t.isIdentifier(property)) {
      propertyArray.push(property.name)
    }
    /**
     * 将this.props.func(a,b,c); -> this.__triggerPropsFn('func', [a,b,c]);
     * 将this.props.obj.func(a,b,c); -> this.__triggerPropsFn('obj.func', [a,b,c]);
     */
    if (t.isMemberExpression(object)) {
      if (t.isThisExpression(object.object) &&
        t.isIdentifier(object.property) &&
        object.property.name === 'props'
      ) {
        if (Adapters.alipay === Adapter.type) {
          if (binded) args.shift()
          path.replaceWith(
            t.callExpression(
              t.memberExpression(t.thisExpression(), t.identifier('__triggerPropsFn')),
              [
                t.stringLiteral(propertyArray.reverse().join('.')),
                t.arrayExpression(args)
              ]
            )
          )
        } else {
          path.replaceWith(
            t.callExpression(
              t.memberExpression(t.thisExpression(), t.identifier('__triggerPropsFn')),
              [t.stringLiteral(propertyArray.reverse().join('.')), t.callExpression(
                t.memberExpression(t.arrayExpression([t.nullLiteral()]), t.identifier('concat')),
                [t.arrayExpression(args)]
              )]
            )
          )
        }
      }
      traverseMember(object)
    }
  }
  traverseMember(member)
}

interface Result {
  template: string
  components: {
    name: string,
    path: string,
    type: string
  }[],
  componentProperies: string[]
}

interface Ref {
  refName?: string,
  type: 'component' | 'dom',
  id: string,
  fn?: t.FunctionExpression | t.ArrowFunctionExpression | t.MemberExpression
}

class Transformer {
  public result: Result = {
    template: '',
    components: [],
    componentProperies: []
  }
  private methods: ClassMethodsMap = new Map()
  private initState: Set<string> = new Set()
  private jsxReferencedIdentifiers = new Set<t.Identifier>()
  private customComponents: Map<string, { sourcePath: string, type: string }> = new Map()
  private anonymousMethod: Map<string, string> = new Map()
  private renderMethod: null | NodePath<t.ClassMethod> = null
  private moduleNames: string[]
  private classPath: NodePath<t.ClassDeclaration>
  private customComponentNames = new Set<string>()
  private usedState = new Set<string>()
  private loopStateName: Map<NodePath<t.CallExpression>, string> = new Map()
  private customComponentData: Array<t.ObjectProperty> = []
  private componentProperies: Set<string>
  private sourcePath: string
  private refs: Ref[] = []
  private loopRefs: Map<t.JSXElement, LoopRef> = new Map()

  constructor (
    path: NodePath<t.ClassDeclaration>,
    sourcePath: string,
    componentProperies: string[]
  ) {
    this.classPath = path
    this.sourcePath = sourcePath
    this.moduleNames = Object.keys(path.scope.getAllBindings('module'))
    this.componentProperies = new Set(componentProperies)
    this.compile()
  }

  setMultipleSlots () {
    const body = this.classPath.node.body.body
    if (body.some(c => t.isClassProperty(c) && c.key.name === 'multipleSlots')) {
      return
    }
    const multipleSlots: any = t.classProperty(t.identifier('multipleSlots'), t.booleanLiteral(true))
    multipleSlots.static = true
    body.push(multipleSlots)
  }

  createStringRef (componentName: string, id: string, refName: string) {
    this.refs.push({
      type: DEFAULT_Component_SET.has(componentName) ? 'dom' : 'component',
      id,
      refName
    })
  }

  createFunctionRef (componentName: string, id: string, fn) {
    this.refs.push({
      type: DEFAULT_Component_SET.has(componentName) ? 'dom' : 'component',
      id,
      fn
    })
  }

  handleRefs () {
    /**
     * this.refs 是在 this.traverse遍历时收集到的，然后将收集到的refs挂到class的属性上
     * 
     * class Index {
     *   ...,
     *   $$refs = [{
     *    type: "dom",
     *    id: "随机字符串",
     *    refName: "",
     *    fn: this.saveRef
     *   }, {
     *    type: "component",
     *    id: "gMFQv",
     *    refName: "title",
     *    fn: null
     *   }]
     * }
     */
    const objExpr = this.refs.map(ref => {
      return t.objectExpression([
        t.objectProperty(
          t.identifier('type'),
          t.stringLiteral(ref.type)
        ),
        t.objectProperty(
          t.identifier('id'),
          t.stringLiteral(ref.id)
        ),
        t.objectProperty(
          t.identifier('refName'),
          t.stringLiteral(ref.refName || '')
        ),
        t.objectProperty(
          t.identifier('fn'),
          ref.fn ? ref.fn : t.nullLiteral()
        )
      ])
    })

    this.classPath.node.body.body.push(t.classProperty(
      t.identifier('$$refs'),
      t.arrayExpression(objExpr)
    ))
  }

  traverse () {
    const self = this
    self.classPath.traverse({
      JSXOpeningElement: (path) => {
        const jsx = path.node
        const attrs = jsx.attributes
        if (!t.isJSXIdentifier(jsx.name)) {
          return
        }
        const loopCallExpr = path.findParent(p => isArrayMapCallExpression(p))
        const componentName = jsx.name.name
        // 找到所有的ref属性
        const refAttr = findJSXAttrByName(attrs, 'ref')
        if (!refAttr) {
          return
        }
        // 找到所有的id属性
        const idAttr = findJSXAttrByName(attrs, 'id')
        // 随机生成id
        let id: string = createRandomLetters(5)
        let idExpr: t.Expression
        /**
         * 这里是处理如果tag上没有写死 id 属性时自动添加上 id=randomStr
         * 在map循环中 id = randomStr +index
         */
        if (!idAttr) {
            // 在Array.map中
          if (loopCallExpr && loopCallExpr.isCallExpression()) {
            const [ func ] = loopCallExpr.node.arguments
            let indexId: t.Identifier | null = null
            if (t.isFunctionExpression(func) || t.isArrowFunctionExpression(func)) {
              const params = func.params as t.Identifier[]
              // 取到index值
              indexId = params[1]
            }
            if (indexId === null || !t.isIdentifier(indexId!)) {
              throw codeFrameError(path.node, '在循环中使用 ref 必须暴露循环的第二个参数 `index`')
            }
            attrs.push(t.jSXAttribute(t.jSXIdentifier('id'), t.jSXExpressionContainer(
              t.binaryExpression('+', t.stringLiteral(id), indexId)
            )))
          } else {
            attrs.push(t.jSXAttribute(t.jSXIdentifier('id'), t.stringLiteral(id)))
          }
        } else {
          // 有写死过id
          const idValue = idAttr.value
          if (t.isStringLiteral(idValue)) {
            id = idValue.value
          } else if (t.isJSXExpressionContainer(idValue)) {
            if (t.isStringLiteral(idValue.expression)) {
              id = idValue.expression.value
            } else {
              idExpr = idValue.expression
            }
          }
        }

        // 如果ref属性是字符串且不在循环中，则添加StringRef
        // ref="myRef"
        if (t.isStringLiteral(refAttr.value)) {
          if (loopCallExpr) {
            throw codeFrameError(refAttr, '循环中的 ref 只能使用函数。')
          }
          this.createStringRef(componentName, id, refAttr.value.value)
        }
        // 如果ref属性是jsx表达式 // ref={any}
        if (t.isJSXExpressionContainer(refAttr.value)) {
          const expr = refAttr.value.expression
          // ref={"myRef"}
          if (t.isStringLiteral(expr)) {
            if (loopCallExpr) {
              throw codeFrameError(refAttr, '循环中的 ref 只能使用函数。')
            }
            this.createStringRef(componentName, id, expr.value)
          // ref={this.xxx} / ref={()=> {}}
          } else if (t.isArrowFunctionExpression(expr) || t.isMemberExpression(expr)) {
            const type = DEFAULT_Component_SET.has(componentName) ? 'dom' : 'component'
            if (loopCallExpr) {
              this.loopRefs.set(path.parentPath.node as t.JSXElement, {
                id: idExpr! || id,
                fn: expr,
                type,
                component: path.parentPath as NodePath<t.JSXElement>
              })
            } else {
              this.refs.push({
                type,
                id,
                fn: expr
              })
            }
          } else {
            throw codeFrameError(refAttr, 'ref 仅支持传入字符串、匿名箭头函数和 class 中已声明的函数')
          }
        }
        // 删除ref属性
        for (const [index, attr] of attrs.entries()) {
          if (attr === refAttr) {
            attrs.splice(index, 1)
          }
        }
      },
      ClassMethod (path) {
        const node = path.node
        if (t.isIdentifier(node.key)) {
          const name = node.key.name
          self.methods.set(name, path)
          // 处理render函数
          // 处理吧if(xxx) return; 换成 if(xxx) return null;
          if (name === 'render') {
            self.renderMethod = path
            path.traverse({
              ReturnStatement (returnPath) {
                const arg = returnPath.node.argument
                const ifStem = returnPath.findParent(p => p.isIfStatement())
                if (ifStem && ifStem.isIfStatement() && arg === null) {
                  const consequent = ifStem.get('consequent')
                  if (consequent.isBlockStatement() && consequent.node.body.includes(returnPath.node)) {
                    returnPath.get('argument').replaceWith(t.nullLiteral())
                  }
                }
              }
            })
          }
          // 处理constructor函数
          // 收集所有初始化的state
          if (name === 'constructor') {
            path.traverse({
              AssignmentExpression (p) {
                if (
                  t.isMemberExpression(p.node.left) &&
                  t.isThisExpression(p.node.left.object) &&
                  t.isIdentifier(p.node.left.property) &&
                  p.node.left.property.name === 'state' &&
                  t.isObjectExpression(p.node.right)
                ) {
                  const properties = p.node.right.properties
                  properties.forEach(p => {
                    if (t.isObjectProperty(p) && t.isIdentifier(p.key)) {
                      self.initState.add(p.key.name)
                    }
                  })
                }
              }
            })
          }
        }
      },
      IfStatement (path) {
        // 把if语句中包含jsx语法的复杂判断逻辑用匿名 state 储存
        // if(func()) { return <View> }
        const test = path.get('test') as NodePath<t.Expression>
        const consequent = path.get('consequent')
        if (isContainJSXElement(consequent) && hasComplexExpression(test)) {
          const scope = self.renderMethod && self.renderMethod.scope || path.scope
          generateAnonymousState(scope, test, self.jsxReferencedIdentifiers, true)
        }
      },
      ClassProperty (path) {
        const { key: { name }, value } = path.node
        if (t.isArrowFunctionExpression(value) || t.isFunctionExpression(value)) {
          self.methods.set(name, path)
        }
        // 收集所有初始化的state
        if (name === 'state' && t.isObjectExpression(value)) {
          value.properties.forEach(p => {
            if (t.isObjectProperty(p)) {
              if (t.isIdentifier(p.key)) {
                self.initState.add(p.key.name)
              }
            }
          })
        }
      },
      JSXExpressionContainer (path) {
        path.traverse({
          MemberExpression (path) {
            // 遍历所有的<JSX attr={any} /> 找到使用的state或者 props 添加到 usedState 中
            const sibling = path.getSibling('property')
            if (
              path.get('object').isThisExpression() &&
              (path.get('property').isIdentifier({ name: 'props' }) || path.get('property').isIdentifier({ name: 'state' })) &&
              sibling.isIdentifier()
            ) {
              const attr = path.findParent(p => p.isJSXAttribute()) as NodePath<t.JSXAttribute>
              const isFunctionProp = attr && typeof attr.node.name.name === 'string' && attr.node.name.name.startsWith('on')
              if (!isFunctionProp) {
                self.usedState.add(sibling.node.name)
              }
            }
          }
        })

        const expression = path.get('expression') as NodePath<t.Expression>
        const scope = self.renderMethod && self.renderMethod.scope || path.scope
        const calleeExpr = expression.get('callee')
        const parentPath = path.parentPath
        // 使用了复杂表达式，并且不是bind函数
        if (
          hasComplexExpression(expression) &&
          !(calleeExpr &&
            calleeExpr.isMemberExpression() &&
            calleeExpr.get('object').isMemberExpression() &&
            calleeExpr.get('property').isIdentifier({ name: 'bind' })) // is not bind
        ) {
            generateAnonymousState(scope, expression, self.jsxReferencedIdentifiers)
        } else {
          // 将所有key={any} 生成匿名变量
          if (parentPath.isJSXAttribute()) {
            if (!(expression.isMemberExpression() || expression.isIdentifier()) && parentPath.node.name.name === 'key') {
                generateAnonymousState(scope, expression, self.jsxReferencedIdentifiers)
            }
          }
        }
        const attr = path.findParent(p => p.isJSXAttribute()) as NodePath<t.JSXAttribute>
        if (!attr) return
        const key = attr.node.name
        const value = attr.node.value
        if (!t.isJSXIdentifier(key)) {
          return
        }
        // 处理所有onXxx的事件属性，生成匿名函数
        if (t.isJSXIdentifier(key) && key.name.startsWith('on') && t.isJSXExpressionContainer(value)) {
            const expr = value.expression
            if (t.isCallExpression(expr) && t.isMemberExpression(expr.callee) && t.isIdentifier(expr.callee.property, { name: 'bind' })) {
                self.buildAnonymousFunc(attr, expr, true)
            } else if (t.isMemberExpression(expr)) {
            self.buildAnonymousFunc(attr, expr as any, false)
          } else {
            throw codeFrameError(path.node, '组件事件传参只能在类作用域下的确切引用(this.handleXX || this.props.handleXX)，或使用 bind。')
          }
        }
        const jsx = path.findParent(p => p.isJSXOpeningElement()) as NodePath<t.JSXOpeningElement>
        if (!jsx) return
        const jsxName = jsx.node.name
        if (!t.isJSXIdentifier(jsxName)) return
        if (expression.isJSXElement()) return
        // TODO: 这里没懂是干嘛
        if (DEFAULT_Component_SET.has(jsxName.name) || expression.isIdentifier() || expression.isMemberExpression() || expression.isLiteral() || expression.isLogicalExpression() || expression.isConditionalExpression() || key.name.startsWith('on') || expression.isCallExpression()) return
        generateAnonymousState(scope, expression, self.jsxReferencedIdentifiers)
      },
      JSXElement (path) {
        const id = path.node.openingElement.name
        // 收集所有导入并且使用过的自定义组件
        if (
          t.isJSXIdentifier(id) &&
          !DEFAULT_Component_SET.has(id.name) &&
          self.moduleNames.indexOf(id.name) !== -1
        ) {
          const name = id.name
          const binding = self.classPath.scope.getBinding(name)

          if (binding && t.isImportDeclaration(binding.path.parent)) {
            const sourcePath = binding.path.parent.source.value
            // import Custom from './xxx';
            if (binding.path.isImportDefaultSpecifier()) {
              self.customComponents.set(name, {
                sourcePath,
                type: 'default'
              })
            } else {
              // import { Custom } from './xxx';
              self.customComponents.set(name, {
                sourcePath,
                type: 'pattern'
              })
            }
          }
        }
      },
      MemberExpression: (path) => {
        const object = path.get('object')
        const property = path.get('property')
        if (
          !(
            object.isThisExpression() && property.isIdentifier({ name: 'props' })
          )
        ) {
          return
        }
        const parentPath = path.parentPath
        // 处理所有this.props.xxx
        if (parentPath.isMemberExpression()) {
          const siblingProp = parentPath.get('property')
          if (siblingProp.isIdentifier()) {
            const name = siblingProp.node.name
            if (name === 'children') {
              // 将所有的 <View>{this.props.children}</View> -> <slot />;
              // 注意只能是{this.props.children} 
              // 不能是 const { children } = this.props; <View>{children}</View>
              // 不能是 const p = this.props; <View>{p.children}</View>
              parentPath.replaceWith(t.jSXElement(t.jSXOpeningElement(t.jSXIdentifier('slot'), [], true), t.jSXClosingElement(t.jSXIdentifier('slot')), [], true))
            } else if (/^render[A-Z]/.test(name)) {
              // 将所有的 <View>{this.props.renderAbc}</View> -> <slot name="abc" />;
              // 其他限制同上
              const slotName = getSlotName(name)
              parentPath.replaceWith(t.jSXElement(t.jSXOpeningElement(t.jSXIdentifier('slot'), [
                t.jSXAttribute(t.jSXIdentifier('name'), t.stringLiteral(slotName))
              ], true), t.jSXClosingElement(t.jSXIdentifier('slot')), []))

              // 给class上添加静态属性 static multipleSlots = true
              this.setMultipleSlots()
            } else {
              // 收集其他使用到的props名称
              self.componentProperies.add(siblingProp.node.name)
            }
          }
        } else if (parentPath.isVariableDeclarator()) {
          // 处理对this.props的结构语法, 收集所有用到的props
          // const { a, b, c, ...rest } = this.props;
          const siblingId = parentPath.get('id')
          if (siblingId.isObjectPattern()) {
            const properties = siblingId.node.properties
            for (const prop of properties) {
              if (t.isRestProperty(prop)) {
                throw codeFrameError(prop.loc, 'this.props 不支持使用 rest property 语法，请把每一个 prop 都单独列出来')
              } else if (t.isIdentifier(prop.key)) {
                self.componentProperies.add(prop.key.name)
              }
            }
          }
        }
      },

      CallExpression (path) {
        const node = path.node
        const callee = node.callee
        // 处理所有a.b.c(); 形式调用的函数
        if (t.isMemberExpression(callee) && t.isMemberExpression(callee.object)) {
          const property = callee.property
          if (t.isIdentifier(property)) {
            if (property.name.startsWith('on')) {
              self.componentProperies.add(`__fn_${property.name}`)
              processThisPropsFnMemberProperties(callee, path, node.arguments, false)
            } else if (property.name === 'call' || property.name === 'apply') {
              self.componentProperies.add(`__fn_${property.name}`)
              processThisPropsFnMemberProperties(callee.object, path, node.arguments, true)
            }
          }
        }
      }
    })
  }

  buildAnonymousFunc = (attr: NodePath<t.JSXAttribute>, expr: t.CallExpression, isBind = false) => {
    const { code } = generate(expr)
    if (code.startsWith('this.props')) {
      const methodName = findMethodName(expr)
      const hasMethodName = this.anonymousMethod.has(methodName) || !methodName
      const funcName = hasMethodName
        ? this.anonymousMethod.get(methodName)!
        // 测试时使用1个稳定的 uniqueID 便于测试，实际使用5个英文字母，否则小程序不支持
        : process.env.NODE_ENV === 'test' ? uniqueId('funPrivate') : `funPrivate${createRandomLetters(5)}`
      this.anonymousMethod.set(methodName, funcName)
      const newVal = isBind
        ? t.callExpression(t.memberExpression(t.memberExpression(t.thisExpression(), t.identifier(funcName)), t.identifier('bind')), expr.arguments || [])
        : t.memberExpression(t.thisExpression(), t.identifier(funcName))
      attr.get('value.expression').replaceWith(newVal)
      this.methods.set(funcName, null as any)
      this.componentProperies.add(methodName)
      if (hasMethodName) {
        return
      }
      const attrName = attr.node.name
      if (t.isJSXIdentifier(attrName) && attrName.name.startsWith('on')) {
        this.componentProperies.add(`__fn_${attrName.name}`)
      }
      if (methodName.startsWith('on')) {
        this.componentProperies.add(`__fn_${methodName}`)
      }
      const method = t.classMethod('method', t.identifier(funcName), [], t.blockStatement([
        t.expressionStatement(t.callExpression(
          t.memberExpression(t.thisExpression(), t.identifier('__triggerPropsFn')),
          [t.stringLiteral(methodName), t.arrayExpression([t.spreadElement(t.identifier('arguments'))])]
        ))
      ]))
      this.classPath.node.body.body = this.classPath.node.body.body.concat(method)
    }
  }

  setComponents () {
    this.customComponents.forEach((component, name) => {
      this.result.components.push({
        path: pathResolver(component.sourcePath, this.sourcePath),
        name: kebabCase(name),
        type: component.type
      })
    })
  }

  resetConstructor () {
    const body = this.classPath.node.body.body
    // 如果未定义 constructor 则主动创建一个
    if (!this.methods.has('constructor')) {
      const ctor = buildConstructor()
      body.unshift(ctor)
    }
    if (process.env.NODE_ENV === 'test') {
      return
    }
    for (const method of body) {
      if (t.isClassMethod(method) && method.kind === 'constructor') {
        // 找到 constructor 改成 _constructor
        // 找到 super(xxx) 改成 super._constructor(xxx);
        method.kind = 'method'
        method.key = t.identifier('_constructor')
        if (t.isBlockStatement(method.body)) {
          for (const statement of method.body.body) {
            if (t.isExpressionStatement(statement)) {
              const expr = statement.expression
              if (t.isCallExpression(expr) && (t.isIdentifier(expr.callee, { name: 'super' }) || t.isSuper(expr.callee))) {
                expr.callee = t.memberExpression(t.identifier('super'), t.identifier('_constructor'))
              }
            }
          }
        }
      }
    }
  }

  handleLifecyclePropParam (propParam: t.LVal, properties: Set<string>) {
    let propsName: string | null = null
    if (!propParam) {
      return null
    }
    // 解析生命周期获取propsName
    if (t.isIdentifier(propParam)) {
      // shouldComponentUpdate(myProps) => propName = myProps;
      propsName = propParam.name
    } else if (t.isObjectPattern(propParam)) {
      // shouldComponentUpdate({ name, age }) => propName = null; properties = [ 'name', 'age' ]
      for (const prop of propParam.properties) {
        if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
          properties.add(prop.key.name)
        } else if (t.isRestProperty(prop) && t.isIdentifier(prop.argument)) {
          propsName = prop.argument.name
        }
      }
    } else {
      throw codeFrameError(propParam.loc, '此生命周期的第一个参数只支持写标识符或对象解构')
    }
    return propsName
  }

  findMoreProps () {
    // 这个方法的目的是收集到更多使用的props
    // 因为前面处理了的只有 constructor 和 this.props.xxx const { xxx } = this.props;
    // 
    // 下面遍历所有的带有使用props的声明周期，找到有使用的props属性并收集

    /**
     * 在能生命周期里收集的props如下：
     * shouldComponentUpdate(props) {
     *  console.log(props.arg1);
     *  const { arg2, arg3 } = props;
     *  const p = props;
     *  console.log(p.arg4)
     *  const { arg5 } = p;
     * }
     * shouldComponentUpdate({ arg6, arg7 }) {
     * }
     * 
     * 最终能收集到的 [arg1,arg2,arg3,arg6,arg7];
     * [arg4, arg5] 不能收集到
     */


    // 第一个参数是 props 的生命周期
    const lifeCycles = new Set([
      // 'constructor',
      'componentDidUpdate',
      'shouldComponentUpdate',
      'getDerivedStateFromProps',
      'getSnapshotBeforeUpdate',
      'componentWillReceiveProps',
      'componentWillUpdate'
    ])
    const properties = new Set<string>()
    // 这里的methods是遍历ast的时候收集到的
    this.methods.forEach((method, name) => {
      if (!lifeCycles.has(name)) {
        return
      }
      const node = method.node
      let propsName: null | string = null
      if (t.isClassMethod(node)) {
        propsName = this.handleLifecyclePropParam(node.params[0], properties)
      } else if (t.isArrowFunctionExpression(node.value) || t.isFunctionExpression(node.value)) {
        propsName = this.handleLifecyclePropParam(node.value.params[0], properties)
      }
      if (propsName === null) {
        return
      }
      // 如果找到了propsName说明有类似 shouldComponentUpdate(props) {}
      // 遍历方法ast
      method.traverse({
        MemberExpression (path) {
          if (!path.isReferencedMemberExpression()) {
            return
          }
          // 进行成员表达式遍历 a.b.c 找到所有 propsName.xxx并收集
          const { object, property } = path.node
          if (t.isIdentifier(object, { name: propsName }) && t.isIdentifier(property)) {
            properties.add(property.name)
          }
        },
        VariableDeclarator (path) {
          // 进行变量定义遍历 找到所有 const { name, age } = propsName;
          const { id, init } = path.node
          if (t.isObjectPattern(id) && t.isIdentifier(init, { name: propsName })) {
            for (const prop of id.properties) {
              if (t.isObjectProperty(prop) && t.isIdentifier(prop.key)) {
                properties.add(prop.key.name)
              }
            }
          }
        }
      })
      properties.forEach((value) => {
        this.componentProperies.add(value)
      })
    })
  }

  parseRender () {
    if (this.renderMethod) {
      this.result.template = this.result.template
        + new RenderParser(
          this.renderMethod,
          this.methods,
          this.initState,
          this.jsxReferencedIdentifiers,
          this.usedState,
          this.loopStateName,
          this.customComponentNames,
          this.customComponentData,
          this.componentProperies,
          this.loopRefs
        ).outputTemplate
    } else {
      throw codeFrameError(this.classPath.node.loc, '没有定义 render 方法')
    }
  }

  compile () {
    this.traverse()
    this.setComponents()
    this.resetConstructor()
    this.findMoreProps()
    this.handleRefs()
    this.parseRender()
    this.result.componentProperies = [...this.componentProperies]
  }
}

export { Transformer }
