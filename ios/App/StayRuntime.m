#import "StayRuntime.h"
#import <Python/Python.h>

static PyStatus AddPath(PyConfig *config, NSString *path) {
    wchar_t *wide = Py_DecodeLocale(path.fileSystemRepresentation, NULL);
    if (!wide) return PyStatus_NoMemory();
    PyStatus status = PyWideStringList_Append(&config->module_search_paths, wide);
    PyMem_RawFree(wide);
    return status;
}

static NSString *PythonError(void) {
    PyObject *error = PyErr_GetRaisedException();
    PyObject *text = error ? PyObject_Str(error) : NULL;
    const char *message = text ? PyUnicode_AsUTF8(text) : NULL;
    NSString *result = message ? [NSString stringWithUTF8String:message] : @"Python 启动失败。";
    Py_XDECREF(text);
    Py_XDECREF(error);
    return result;
}

static NSDictionary<NSString *, id> *Launch(NSString *directory, NSString *secret, BOOL demo) {
    NSString *resources = NSBundle.mainBundle.resourcePath;
    NSString *home = [resources stringByAppendingPathComponent:@"python"];
    NSString *library = [home stringByAppendingPathComponent:@"lib/python3.13"];
    NSString *dynamic = [library stringByAppendingPathComponent:@"lib-dynload"];
    NSString *backend = [resources stringByAppendingPathComponent:@"Backend"];

    PyPreConfig preconfig;
    PyPreConfig_InitIsolatedConfig(&preconfig);
    preconfig.utf8_mode = 1;
    PyStatus status = Py_PreInitialize(&preconfig);
    if (PyStatus_Exception(status)) {
        return @{@"error": [NSString stringWithUTF8String:status.err_msg ?: "Python 初始化失败"]};
    }

    PyConfig config;
    PyConfig_InitIsolatedConfig(&config);
    config.install_signal_handlers = 0;
    config.write_bytecode = 0;
    config.site_import = 0;
    config.module_search_paths_set = 1;
    status = PyConfig_SetBytesString(&config, &config.home, home.fileSystemRepresentation);
    for (NSString *path in @[library, dynamic, backend]) {
        if (!PyStatus_Exception(status)) status = AddPath(&config, path);
    }
    if (!PyStatus_Exception(status)) status = Py_InitializeFromConfig(&config);
    NSString *configurationError = PyStatus_Exception(status)
        ? [NSString stringWithUTF8String:status.err_msg ?: "Python 配置失败"] : nil;
    PyConfig_Clear(&config);
    if (configurationError) return @{@"error": configurationError};

    PyObject *module = PyImport_ImportModule("stay.ios_host");
    PyObject *function = module ? PyObject_GetAttrString(module, "launch") : NULL;
    PyObject *result = function ? PyObject_CallFunction(function, "ssO",
        directory.fileSystemRepresentation, secret.UTF8String, demo ? Py_True : Py_False) : NULL;
    long port = result ? PyLong_AsLong(result) : 0;
    NSDictionary *answer = port > 0 && port <= 65535 ? @{@"port": @(port)} : @{@"error": PythonError()};
    Py_XDECREF(result);
    Py_XDECREF(function);
    Py_XDECREF(module);
    // The HTTP workers acquire the interpreter after startup returns.
    PyEval_SaveThread();
    return answer;
}

NSDictionary<NSString *, id> *StayStart(NSString *directory, NSString *secret, BOOL demo) {
    static NSDictionary<NSString *, id> *result;
    static dispatch_once_t once;
    dispatch_once(&once, ^{ result = Launch(directory, secret, demo); });
    return result;
}
