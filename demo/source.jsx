import { Provider } from '@tarojs/mobx'
import Taro, { Component } from '@tarojs/taro'
import { View, Button } from '@tarojs/components'
import { Custom } from './Custom';

const myStore = {};
export default class Index extends Component {

    constructor(props) {
        super(props);
        this.func = () => { };
        this.func2 = this.func.bind(this);
        this.state = {
            list: []
        }
    }

    state = {
        list2: []
    }

    config = {
        usingComponents: {
            'ec-canvas': '../../components/ec-canvas/ec-canvas'
        }
    }

    componentDidUpdate(props) {
        console.log('', props.arg1)
        const { arg4, arg5 } = props;
        const p = props;
        console.log('', p.arg6)
    }

    shouldComponentUpdate({ arg2, arg3 }) {
        console.log('', arg2, arg3);
    }

    saveRef = (ref) => this.dom = ref;

    add = async () => {
        const a = `hahaha${this}${3}${true}`;
        const list = [...this.state.list];
        list.add({});
        this.setState({ list });
    }

    remove = (id) => {
        const list = this.state.list.filter(v=>v.id !== id);
        this.setState({ list });
    }

  render () {

    const a = {
      add1: this.props.add
    };

    if (this.add()) {
        return <View/>
    }


    let serviceView;
  
    const service = [
        {
        icon: 'pay',
        text: '佣金明细'
        },
        {
        icon: 'order',
        text: '分销订单'
        }
    ];

    serviceView = service.map(item => {
        return <Text>{item.text}</Text>
    });
    

    const pAdd = this.props.add

    const { key, children, onXXX2 } = this.props;
    const onXXX3 = this.props.xxx;

    this.onTick1();
    
    a.b.c();

    this.props.c.onTick2();
    this.props.onTick3.call();
    this.props.onTick4.apply();
    this.props.onTick5.apply();

    const { props } = this;
    console.log(props.a);

    // if(test) {
    //     return (

    //     )
    // }
    onXXX3(()=>  {});
    onXXX2(()=>  {});
    onXXX2.call(()=>  {});
    props.onXXX(()=>  {});
    
    return (
        <Provider store={myStore}>
          {test ? this.func() : this.func()}
          {this.func() && <View2  />}
          {this.func() || <View />}

          {test ? <View /> : undefined}
          {test ? <View /> : 'string'}
          {test ? undefined : <View />}
          {test ? 'string' : <View />}
          {test ? <View /> : <View2 />}
          {test ? <View /> : this.func()}
          {test ? this.func() : <View />}
          {test ? <View /> : pAdd}
          {test ? <View /> : (test ? 1 : 2)}

          {}
          {null}
          <View className='index' ref={this.saveRef}>
              {this.props.children}
              {children}
              {props.children}
              {this.props.renderABC}
              {props.renderA}
              <Custom />
              <View className='title' ref='title' attr={this.$router.params} >title</View>
              <View className='content' ref={'content'} style={{ color: '#FFF' }}>
                {this.state.list.filter(v=>({ v })).map((item, index) => {
                    return (
                    <View ref={()=>'index'} className='item'>
                        <View>{item}</View>
                        <Button className='del' onClick={this.remove.bind(this, item.id, item.id2, item.id3)}>删除</Button>
                    </View>
                    )
                })}
                {this.state.list.map(item2 => (
                    <View key={item2.index} className='item'>
                        <View>{item2}</View>
                    </View>
                ))}
                <View key={'123'}>{this.props.value}</View>
                <View className={'add'}>{this.props.value}</View>
                <Button onClick1={this.state.add.bind(this, 123, hca)}>添加</Button>
                <Button className={this.props.add3} onClick2={pAdd}>添加</Button>
                <Button className='add' onClick3={props.add234}>添加</Button>
                <Button className='add' onClick4={this.add}>添加</Button>
                <Button className='add' onClick5={this.props.add3}>添加</Button>
              </View>
          </View>
        </Provider>
    )
  }
}