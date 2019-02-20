import { setStore } from '@tarojs/mobx';
import Taro, { Component as __BaseComponent, internal_safe_get, internal_get_original, internal_inline_style, getElementById } from '@tarojs/taro';
import { View, Button } from '@tarojs/components';
import { Custom } from './Custom';

const myStore = {};
setStore(myStore);
export default class Index extends __BaseComponent {
  static properties = {
    "add": {
      "type": null,
      "value": null
    },
    "key": {
      "type": null,
      "value": null
    },
    "children": {
      "type": null,
      "value": null
    },
    "onXXX2": {
      "type": null,
      "value": null
    },
    "xxx": {
      "type": null,
      "value": null
    },
    "__fn_onTick2": {
      "type": null,
      "value": null
    },
    "__fn_call": {
      "type": null,
      "value": null
    },
    "__fn_apply": {
      "type": null,
      "value": null
    },
    "__fn_onXXX2": {
      "type": null,
      "value": null
    },
    "value": {
      "type": null,
      "value": null
    },
    "add3": {
      "type": null,
      "value": null
    },
    "__fn_onClick2": {
      "type": null,
      "value": null
    },
    "__fn_onClick5": {
      "type": null,
      "value": null
    },
    "arg1": {
      "type": null,
      "value": null
    },
    "arg4": {
      "type": null,
      "value": null
    },
    "arg5": {
      "type": null,
      "value": null
    }
  };
  static $$events = ["remove", "add", "funPrivateJYMag", "add234", "funPrivateMrCXy"];
  $usedState = ["anonymousState__temp", "anonymousState__temp2", "anonymousState__temp3", "anonymousState__temp4", "anonymousState__temp5", "anonymousState__temp6", "anonymousState__temp7", "anonymousState__temp8", "anonymousState__temp9", "loopArray0", "test", "_params", "$anonymousCallee__0", "pAdd", "hca", "children", "list", "list2", "add", "key", "xxx", "__fn_onTick2", "__fn_call", "__fn_apply", "value", "add3", "__fn_onClick2", "__fn_onClick5", "arg1", "arg4", "arg5", "renderABC"];


  _constructor(props) {
    super._constructor(props);

    this.func2 = this.func.bind(this);
    this.state = {
      list: []
    };
  }

  state = {
    list2: []
  };

  config = {
    usingComponents: {
      'ec-canvas': '../../components/ec-canvas/ec-canvas'
    }
  };

  componentDidUpdate(props) {
    console.log('', props.arg1);
    const { arg4, arg5 } = props;
    const p = props;
    console.log('', p.arg6);
  }

  shouldComponentUpdate({ arg2, arg3 }) {
    console.log('', arg2, arg3);
  }

  saveRef = ref => this.dom = ref;

  add = async () => {
    const a = "hahaha" + this + 3 + true;
    const list = [...this.state.list];
    list.add({});
    this.setState({ list });
  };

  remove = id => {
    const list = this.state.list.filter(v => v.id !== id);
    this.setState({ list });
  };

  _createData() {
    this.__state = arguments[0] || this.state || {};
    this.__props = arguments[1] || this.props || {};
    ;
    const _params = this.$router.params;
    const __scope = this.$scope;


    const a = {
      add1: this.__props.add
    };

    const anonymousState__temp = this.add();
    if (anonymousState__temp) {
      return null;
    }

    const service = [{
      icon: 'pay',
      text: '佣金明细'
    }, {
      icon: 'order',
      text: '分销订单'
    }];

    const pAdd = this.__props.add;

    const { key, children, onXXX2 } = this.__props;
    const onXXX3 = this.__props.xxx;

    this.onTick1();

    a.b.c();

    this.__triggerPropsFn("c.onTick2", [null].concat([]));
    this.__triggerPropsFn("onTick3", [null].concat([]));
    this.__triggerPropsFn("onTick4", [null].concat([]));
    this.__triggerPropsFn("onTick5", [null].concat([]));

    const state = this.__state;

    console.log(props.a);

    // if(test) {
    //     return (

    //     )
    // }
    this.__props.xxx(() => {});
    this.__triggerPropsFn("onXXX2", [null].concat([() => {}]));
    this.__triggerPropsFn("onXXX2", [null].concat([() => {}]));
    props.onXXX(() => {});

    const anonymousState__temp2 = test ? this.func() : this.func();
    const anonymousState__temp3 = internal_inline_style({ color: '#FFF' });
    const anonymousState__temp4 = '123';
    const anonymousState__temp5 = this.func();
    const anonymousState__temp6 = this.func() ? this.func() : null;
    const anonymousState__temp7 = anonymousState__temp6 ? this.func() : null;
    const anonymousState__temp8 = this.func();
    const anonymousState__temp9 = test ? this.func() : null;

    const $anonymousCallee__0 = this.__state.list.filter(v => ({ v }));

    const loopArray0 = this.__state.list.filter(v => ({ v })).map((item, index) => {
      item = {
        $original: internal_get_original(item)
      };

      const __ref = __scope && getElementById(__scope, "#" + ("YDynJ" + index));

      __ref && (() => 'index')(__ref);
      return {
        $original: item.$original
      };
    });

    Object.assign(this.__state, {
      anonymousState__temp: anonymousState__temp,
      anonymousState__temp2: anonymousState__temp2,
      anonymousState__temp3: anonymousState__temp3,
      anonymousState__temp4: anonymousState__temp4,
      anonymousState__temp5: anonymousState__temp5,
      anonymousState__temp6: anonymousState__temp6,
      anonymousState__temp7: anonymousState__temp7,
      anonymousState__temp8: anonymousState__temp8,
      anonymousState__temp9: anonymousState__temp9,
      loopArray0: loopArray0,
      test: test,
      _params: _params,
      $anonymousCallee__0: $anonymousCallee__0,
      pAdd: pAdd,
      hca: hca,
      children: children
    });
    return this.__state;
  }
  func = () => {};
  static multipleSlots = true;

  funPrivateJYMag() {
    this.__triggerPropsFn("add", [...arguments]);
  }

  funPrivateMrCXy() {
    this.__triggerPropsFn("add3", [...arguments]);
  }

  $$refs = [{
    type: "dom",
    id: "hWxBB",
    refName: "",
    fn: this.saveRef
  }, {
    type: "dom",
    id: "eKGHN",
    refName: "title",
    fn: null
  }, {
    type: "dom",
    id: "oScHS",
    refName: "content",
    fn: null
  }];
}